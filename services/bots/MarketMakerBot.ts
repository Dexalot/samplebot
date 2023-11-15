import axios from "axios";
import { getConfig } from "../../config";
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import NewOrder from "./classes";

class MarketMakerBot extends AbstractBot {
  protected marketPrice = new BigNumber(0);
  protected baseUsd = 0; 
  protected quoteUsd = 0; 
  protected capitalASideUSD = 300;
  protected orderUpdaterCounter = 0;
  protected lastMarketPrice = new BigNumber(0);
  protected bidSpread: any;
  protected askSpread: any;
  protected orderLevels: any;
  protected orderLevelSpread: any;
  protected orderLevelQty: any;
  protected refreshOrderTolerance: any;
  protected flatAmount: any;
  protected takerSpread: any;
  protected takerEnabled: any;
  protected timer: any;
  protected lastBaseUsd: any;
  protected lastUpdate = 0;
  protected defensiveSkew: any;
  protected slip: any;
  protected lastChange = 0;
  protected useRetrigger = false;
  protected useIndependentLevels: boolean = false;
  protected independentLevels: any;

  constructor(botId: number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
    // Will try to rebalance the amounts in the Portfolio Contract
    this.portfolioRebalanceAtStart = false;
    this.config = getConfig(this.tradePairIdentifier);
    this.bidSpread = this.config.bidSpread/100;
    this.askSpread = this.config.askSpread/100;
    this.orderLevels = this.config.orderLevels;
    this.orderLevelSpread = this.config.orderLevelSpread/100;
    this.orderLevelQty = this.config.orderLevelQty;
    this.refreshOrderTolerance = this.config.refreshOrderTolerance/100;
    this.flatAmount = this.config.flatAmount;
    this.takerSpread = this.config.takerSpread/100;
    this.takerEnabled = this.config.takerEnabled;
    this.defensiveSkew = this.config.defensiveSkew/100;
    this.slip = this.config.slip;
    this.useRetrigger = this.config.useRetrigger
    this.useIndependentLevels = this.config.useIndependentLevels
    this.independentLevels = this.config.independentLevels;
    console.log('this.independentLevels',this.independentLevels)
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
      await this.getNewMarketPrice();
      // await this.getBestOrders();

      this.interval = 10000; //Min 8 seconds

      // PNL  TO KEEP TRACK OF PNL , FEE & TCOST  etc
      //this.PNL = new PNL(getConfig('NODE_ENV_SETTINGS'), this.instanceName, this.base, this.quote, this.config, this.account);

      return true;
    } else {
      return false;
    }
  }

  async startOrderUpdater() {
    if (this.status) {
      // Sleep 30 seconds initially if rebalancing portfolio
      if (this.portfolioRebalanceAtStart){
        await utils.sleep(30000);
      }
      
      this.logger.debug(`${JSON.stringify(this.getOrderBook())}`);

      //Cancel any remaining orders
      await this.cancelOrderList([], 100);

      if (this.baseUsd && this.quoteUsd){
        // ------------ Create and Send Initial Order List ------------ //
        let levels : number[][] = [];
        for (let i = 1; i <= this.orderLevels; i++){
          levels.push([0,i]);
          levels.push([1,i]);
        }
        await this.getBestOrders();
        await this.placeInitialOrders(levels);

        // ------------ Begin Order Updater ------------ //

        this.orderUpdater = setTimeout(()=>{
          this.lastMarketPrice = this.marketPrice;
          this.updateOrders();
        }, this.interval);
      } else {
        console.log("MISSING PRICE DATA - baseUsd:",this.baseUsd, " quoteUsd: ",this.quoteUsd, "Wait 10 seconds then try again");
        await utils.sleep(10000);
        await this.getNewMarketPrice();
        this.startOrderUpdater();
      }
    } else {
      this.logger.warn(`${this.instanceName} Bot Status set to false, will not send orders`);
    }
  }

  // this is the meat and potatoes of the bot. It will repeatedly call itself to refresh orders if the price is outside the refreshOrderTolerance spread, or too much time has passed since the last update.
  async updateOrders() {
    if (this.orderUpdater != undefined) {
      clearTimeout(this.orderUpdater);
    }

    try {
      if (this.status && (this.retrigger || (Date.now() - this.lastUpdate)/1000 > 600 || this.marketPrice.toNumber()<this.lastMarketPrice.toNumber()*(1-parseFloat(this.refreshOrderTolerance)) || this.marketPrice.toNumber()>this.lastMarketPrice.toNumber()*(1+parseFloat(this.refreshOrderTolerance)))){
        this.orderUpdaterCounter ++;
        this.lastUpdate = Date.now();
        this.timer = this.interval;
        console.log("000000000000000 COUNTER:",this.orderUpdaterCounter);

        // Uncomment the following when running both avax markets on the same wallet at the same time to avoid nonce errors because avax/usdc and avax/usdt tend to send orders at the same time. This gives priority to avaxusdc
        // If you're serious about market making, you'll want to set up individual wallets for all of the high volatility markets to avoid nonce conflicts and other possible errors.

        // if (this.tradePairIdentifier == "AVAX/USDt"){
        //   await utils.sleep(500);
        // }
        
        // updates balances, gets best bids and asks, and corrects the nonce
        await Promise.all([this.getBalances(),this.getBestOrders(),this.correctNonce(this.contracts["SubNetProvider"]),this.processOpenOrders()]);
        this.lastChange = Math.abs(this.marketPrice.toNumber()-this.lastMarketPrice.toNumber())/this.marketPrice.toNumber();
        
        let startingBidPriceBG = this.marketPrice.multipliedBy(1-this.getBidSpread()).dp(this.quoteDisplayDecimals, BigNumber.ROUND_DOWN);
        let startingBidPrice = startingBidPriceBG.toNumber();
        let startingAskPriceBG = this.marketPrice.multipliedBy(1+this.getAskSpread()).dp(this.quoteDisplayDecimals,BigNumber.ROUND_UP);
        let startingAskPrice = startingAskPriceBG.toNumber();

        // if the bid and ask are the same price, increase the ask by one tick
        if (startingBidPrice == startingAskPrice){
          startingAskPrice += this.getIncrement();
        }

        // if takerEnabled config is true, these prices will be used to determine what price to place taker orders at.
        let takerBidPrice = parseFloat((this.marketPrice.toNumber() * (1-this.takerSpread)).toFixed(this.quoteDisplayDecimals));
        let takerAskPrice = parseFloat((this.marketPrice.toNumber() * (1+this.takerSpread)).toFixed(this.quoteDisplayDecimals));
        const currentBestAsk = this.currentBestAsk ? this.currentBestAsk : undefined;
        const currentBestBid = this.currentBestBid ? this.currentBestBid : undefined;

        let bids: any[] = []; 
        let asks: any[] = [];
        let duplicates: any[] = [];

        // cycles through all active orders in memory and sorts them into bids or asks. If they are duplicate records, cancel their corresponding orders. They will be replaced on the next loop.
        this.orders.forEach((e,i)=>{
          if (e.side === 0 && e.level > 0 && (e.status == 0 || e.status == 2)){
            let skip = false;
            for (let i = 0;i<bids.length; i++){
              if (bids[i].level === e.level){
                duplicates.push(e.id);
                duplicates.push(bids[i].id);
                skip = true;
              }
            }
            if (!skip){
              bids.push(e);
            }
          } else if (e.side === 1 && e.level > 0 && (e.status == 0 || e.status == 2)) {
            let skip = false;
            for (let i = 0;i<asks.length; i++){
              if (asks[i].level === e.level){
                duplicates.push(e.id);
                duplicates.push(asks[i].id);
                skip = true;
              } 
            }
            if (!skip){
              asks.push(e);
            }
          } else {
            duplicates.push(e.id);
          }
        });
        if (duplicates.length > 0){
          let toCancel = [];
          for (let i = 0; i < duplicates.length; i++){
            if (duplicates[i]){
              toCancel.push(duplicates[i]);
            }
          }
          this.cancelOrderList(toCancel);
        }
      
        let bidsSorted = sortOrders(bids, "price", "descending");
        let asksSorted = sortOrders(asks, "price", "ascending");


        // if takerEnabled is true and best orders are outside of the takerspread, create an immediate or cancel order at the taker price. Otherwise replace orders as usual.
        if (this.takerEnabled && currentBestAsk && takerBidPrice > currentBestAsk && parseFloat(this.contracts[this.quote].portfolioTot) > this.minTradeAmnt) { //taker bid
          await this.cancelOrderList([]);

          let bidAmount: any = 0;
          if (parseFloat(this.contracts[this.quote].portfolioTot) > this.maxTradeAmnt){
            bidAmount = new BigNumber((this.maxTradeAmnt / takerBidPrice) * .99);
          } else {
            bidAmount = new BigNumber((this.contracts[this.quote].portfolioTot / takerBidPrice) * .99);
          }
          let bidPrice = new BigNumber(takerBidPrice);
          console.log("TAKER BUY,",bidAmount,"at: ",bidPrice);
          await this.addOrder(0,bidAmount,bidPrice,1,2,0);
          this.lastMarketPrice = this.marketPrice;
          this.retrigger = true;

        } else if (this.takerEnabled && currentBestBid && takerAskPrice < currentBestBid && parseFloat(this.contracts[this.base].portfolioTot) * takerBidPrice > this.minTradeAmnt){ // taker ask
          await this.cancelOrderList([]);

          let askAmount: any = 0;
          if (this.contracts[this.base].portfolioTot * takerAskPrice > this.maxTradeAmnt){
            askAmount = new BigNumber(this.maxTradeAmnt / takerAskPrice * .99);
          } else {
            askAmount = new BigNumber(this.contracts[this.base].portfolioTot * .99);
          }
          let askPrice = new BigNumber(takerAskPrice);
          console.log("TAKER SELL,",askAmount,"at: ",askPrice);
          await this.addOrder(1,askAmount,askPrice,1,2,0);
          this.lastMarketPrice = this.marketPrice;
          this.retrigger = true;

        } else if (currentBestAsk && startingBidPrice >= currentBestAsk){ // adjust prices if startingBidPrice is higher than the bestAsk. Then replace all orders.

          let startingBidPriceBG = new BigNumber(currentBestAsk - this.getIncrement())
          startingBidPrice = startingBidPriceBG.dp(this.quoteDisplayDecimals,BigNumber.ROUND_DOWN).toNumber();

          await Promise.all([this.replaceBids(bidsSorted, startingBidPrice),this.replaceAsks(asksSorted, startingAskPrice)]);
          this.lastMarketPrice = this.marketPrice;
          if (parseFloat(this.contracts[this.quote].portfolioTot) > this.minTradeAmnt * 2 && this.useRetrigger){
            this.retrigger = true;
          } else {this.retrigger = false;}
        } else if (currentBestBid && startingAskPrice <= currentBestBid){ // adjust prices if startingAskPrice is lower than the bestBid. Then replace all orders.
          let startingAskPriceBG = new BigNumber(currentBestBid + this.getIncrement())
          startingAskPrice = startingAskPriceBG.dp(this.quoteDisplayDecimals,BigNumber.ROUND_UP).toNumber();

          await Promise.all([this.replaceBids(bidsSorted, startingBidPrice),this.replaceAsks(asksSorted, startingAskPrice)]);
          this.lastMarketPrice = this.marketPrice;
          if (parseFloat(this.contracts[this.base].portfolioTot) * takerBidPrice > this.minTradeAmnt * 2 && this.useRetrigger){
            this.retrigger = true;
          } else {this.retrigger = false;}

        } else { // replace all orders
          await Promise.all([this.replaceBids(bidsSorted, startingBidPrice),this.replaceAsks(asksSorted, startingAskPrice)]);
          this.lastMarketPrice = this.marketPrice;
          this.retrigger = false;
        }
          
        }
    } catch (error) {
      this.logger.error(`${this.instanceName} Error in UpdateOrders`, error);
      this.cleanUpAndExit();
    } finally {
      //Update orders again after interval
      this.orderUpdater = setTimeout(async ()=>{
        if (this.status){
          await Promise.all([this.getNewMarketPrice()]);
          this.timer = 2000;
          this.updateOrders();
        }
      }, this.timer);
    }
  }

  // Takes in an array of arrays. The first number of each subarray is the side, the second is the level.
  // For each subarray passed in, it creates a new order and adds it to newOrderList. At the end it calls addLimitOrderList with the newOrderList
  async placeInitialOrders(levels: number[][], availableQuote: number = this.contracts[this.quote].portfolioAvail, availableBase: number = this.contracts[this.base].portfolioAvail){
    console.log("PLACING INITAL ORDERS: ",levels);

    let initialBidPrice = parseFloat((this.marketPrice.toNumber() * (1-this.getBidSpread())).toFixed(this.quoteDisplayDecimals));
    let initialAskPrice = parseFloat((this.marketPrice.toNumber() * (1+this.getAskSpread())).toFixed(this.quoteDisplayDecimals));

    initialBidPrice = this.currentBestAsk && this.currentBestAsk <= initialBidPrice ? this.currentBestAsk - this.getIncrement() : initialBidPrice;
    initialAskPrice = this.currentBestBid && this.currentBestBid >= initialAskPrice ? this.currentBestBid + this.getIncrement() : initialAskPrice;

    let newOrderList : NewOrder[] = [];
    // --------------- SET BIDS --------------- //
    for (let x = 0; x < levels.length; x++){
      if (levels[x][0] == 0){
        let bidPrice = new BigNumber((initialBidPrice * (1-this.getOrderLevelSpread(levels[x][1]-1))).toFixed(this.quoteDisplayDecimals));
        let bidQty = new BigNumber(this.getQty(bidPrice,0,levels[x][1],availableQuote));
        if (bidQty.toNumber() * bidPrice.toNumber() > this.minTradeAmnt){
          availableQuote -= bidQty.toNumber() * bidPrice.toNumber();
          console.log("BID LEVEL ",levels[x][1],": BID PRICE: ", bidPrice.toNumber(),", BID QTY: ",bidQty.toNumber(), "Portfolio Avail: ",availableQuote);
          newOrderList.push(new NewOrder(0,bidQty,bidPrice,levels[x][1]));
        } else {
          console.log("NOT ENOUGH FUNDS TO PLACE INITIAL BID: ", levels[x][1])
        }
      } else {
      //--------------- SET ASKS --------------- //
        let askPrice = new BigNumber((initialAskPrice * (1+this.getOrderLevelSpread(levels[x][1]-1))).toFixed(this.quoteDisplayDecimals));
        let askQty = new BigNumber(this.getQty(askPrice,1,levels[x][1],availableBase));
        if (askQty.toNumber() * askPrice.toNumber() > this.minTradeAmnt){
          availableBase -= askQty.toNumber();
          console.log("ASK LEVEL ",levels[x][1],": ASK PRICE: ", askPrice.toNumber(),", ASK QTY: ",askQty.toNumber(), "Portfolio Avail: ",availableBase);
          newOrderList.push(new NewOrder(1,askQty,askPrice,levels[x][1]));
        } else {
          console.log("NOT ENOUGH FUNDS TO PLACE INITIAL ASK: ", levels[x][1])
        }
      }
    }

  //   // --------------- EXECUTE ORDERS --------------- //
    if (this.status && newOrderList.length > 0){
      this.addLimitOrderList(newOrderList);
    }
  }

  // This function loops through all of the bid orders and updates their corresponding orders and replaces missing orders.
  async replaceBids(bidsSorted: any, startingBidPrice: number){
    console.log("REPLACE BIDS: ",bidsSorted.length, "startingBidPrice:", startingBidPrice);
    let quoteAvail = parseFloat(this.contracts[this.quote].portfolioAvail);
    for (let i = 0; i < this.orderLevels; i ++){
      let order = {id:null, status:null, quantity:new BigNumber(0),quantityfilled:new BigNumber(0), level:0, price: new BigNumber(0)};
      for (let j = 0; j < bidsSorted.length; j++){
        if (bidsSorted[j].level == i+1){
          order = bidsSorted[j];
        }
      }

      if (order.id){
        if (this.refreshLevel(i+1,true)){
          let bidPrice = new BigNumber((startingBidPrice * (1-this.getOrderLevelSpread(i))).toFixed(this.quoteDisplayDecimals));
          let amountOnOrder = (order.quantity.toNumber()-order.quantityfilled.toNumber())*order.price.toNumber() * 0.9999;
          let availableFunds = quoteAvail + amountOnOrder;
          let bidQty = new BigNumber(this.getQty(bidPrice,0,i+1,availableFunds));
          let amountToPlace = bidQty;
          if (availableFunds/bidPrice.toNumber() < amountToPlace.toNumber()){
            amountToPlace = new BigNumber((availableFunds/bidPrice.toNumber())*.999);
          }
          if (amountToPlace.toNumber() * bidPrice.toNumber() > this.minTradeAmnt){
            console.log("REPLACE ORDER:",bidPrice.toNumber(),bidQty.toNumber(), i+1);
            quoteAvail -= bidQty.toNumber() * bidPrice.toNumber() - amountOnOrder
            this.cancelReplaceOrder(order,bidPrice,amountToPlace);
            this.setLevelRefreshPrice(i+1,true);
          } else {
            console.log("NOT ENOUGH FUNDS TO REPLACE", bidQty.toNumber() * bidPrice.toNumber(), quoteAvail, availableFunds, amountOnOrder, amountToPlace.toNumber());
            this.cancelOrder(order);
          }
        }
      } else {
        //set aside funds to create new orders
        let amount = this.getLevelQty(i+1) * startingBidPrice;
        if (amount < quoteAvail){
          quoteAvail -= amount;
          this.placeInitialOrders([[0,i+1]],amount,);
        } else {
          this.placeInitialOrders([[0,i+1]],quoteAvail,);
          quoteAvail = 0;
        }
      }
    }
  }

  // This function loops through all of the ask orders and updates their corresponding orders and replaces missing orders.
  async replaceAsks (asksSorted: any, startingAskPrice: number){
    console.log("REPLACE ASKS: ",asksSorted.length, "startingAskPrice:", startingAskPrice);
    let baseAvail = parseFloat(this.contracts[this.base].portfolioAvail);

    for (let i = 0; i < this.orderLevels; i ++){
      let order = {id:null, status:null, quantity:new BigNumber(0),quantityfilled:new BigNumber(0), level:0};
      for (let j = 0; j < asksSorted.length; j++){
        if (asksSorted[j].level == i+1){
          order = asksSorted[j];
        }
      }
      if (order.id){
        if (this.refreshLevel(i+1,false)){
          let amountOnOrder = (order.quantity.toNumber()-order.quantityfilled.toNumber()) * .9999;
          let availableFunds = baseAvail + amountOnOrder;
  
          let askPrice = new BigNumber((startingAskPrice * (1+this.getOrderLevelSpread(i))).toFixed(this.quoteDisplayDecimals));
          let askQty = new BigNumber(this.getQty(askPrice,1,i+1,availableFunds));
          let amountToPlace = askQty;
          if (availableFunds < askQty.toNumber()){
            amountToPlace = new BigNumber(availableFunds * .999);
          }
          baseAvail -= askQty.toNumber() - amountOnOrder;
          if (amountToPlace.toNumber() * askPrice.toNumber() > this.minTradeAmnt){
            console.log("REPLACE ORDER:",askPrice.toNumber(),amountToPlace.toNumber(), i+1);
            this.cancelReplaceOrder(order,askPrice,amountToPlace);
            this.setLevelRefreshPrice(i+1,false);
          } else {
            console.log("NOT ENOUGH FUNDS TO REPLACE", amountToPlace.toNumber(), availableFunds);
            this.cancelOrder(order);
          }
        }
      } else {
        let amount = this.getLevelQty(i+1) * 1.01;
        if (amount < baseAvail){
          this.placeInitialOrders([[1,i+1]],undefined,amount);
          baseAvail -= amount;
        } else {
          this.placeInitialOrders([[1,i+1]],undefined,baseAvail);
          baseAvail = 0;
        }
      }
    }
  }

  // Takes in price, side, level, and availableFunds. Returns amount to place.
  // If there are enough availableFunds, it will return the intended amount according to configs, otherwise it will return as much as it can. If there is not enough funds to place an order it will return 0
  getQty(price: BigNumber, side: number, level: number, availableFunds: number): number {
    if (side === 0){
      console.log("AVAILABLE FUNDS IN QUOTE BID: ",availableFunds, "AMOUNT: ",this.getLevelQty(level))
      if (this.getLevelQty(level) < availableFunds/price.toNumber()){
        return this.getLevelQty(level);
      } else if (availableFunds > this.minTradeAmnt * 2){
        return availableFunds/price.toNumber() * .9999;
      } else { return 0;}
    } else if (side === 1) {
      console.log("AVAILABLE FUNDS ASK: ",availableFunds, "AMOUNT: ",this.getLevelQty(level))
      if (this.getLevelQty(level) < availableFunds){
          return this.getLevelQty(level);
      } else if (availableFunds * price.toNumber() > this.minTradeAmnt * 2){
        return availableFunds * .9999;
      } else {return 0;}
    } else { 
      return 0; // function declaration requires I return a number
    }
  }


  // returns amount to place for given order level in base asset
  getLevelQty(level:number):number{
    if (level != 1 && this.useIndependentLevels && this.independentLevels[(level).toString()].customQty){
      return this.independentLevels[(level).toString()].customQty;
    } else {
      return parseFloat(this.flatAmount) + (parseFloat(this.orderLevelQty) * (level-1));
    }
  }

  // returns % away from market price to place order
  getOrderLevelSpread(level:number):number{
    if (level != 0 && this.useIndependentLevels && this.independentLevels[(level+1).toString()].customSpread){
      return parseFloat(this.independentLevels[(level+1).toString()].customSpread)/100;
    } else {
      return (level*parseFloat(this.orderLevelSpread))
    }
  }

  getBidSpread():number{
    let slip = 0;
    if (this.lastChange > this.refreshOrderTolerance * 2 && this.slip){
      slip = this.lastChange/2;
    }
    let defensiveSkew = 0;
    let multiple = parseFloat(this.contracts[this.base].portfolioTot)*this.marketPrice.toNumber()/parseFloat(this.contracts[this.quote].portfolioTot);
    if (multiple >= 2 && this.defensiveSkew){
      defensiveSkew = multiple < 6 ? this.defensiveSkew * Math.floor(multiple-1) : this.defensiveSkew * 5
    }
    let bidSpread = this.bidSpread + defensiveSkew + slip;
    console.log("Bid Spread:",bidSpread);
    return bidSpread;
  }

  getAskSpread():number{
    let slip = 0;
    if (this.lastChange > this.refreshOrderTolerance * 2 && this.slip){
      slip = this.lastChange - this.refreshOrderTolerance;
    }
    let defensiveSkew = 0;
    let multiple = parseFloat(this.contracts[this.base].portfolioTot)*this.marketPrice.toNumber()/parseFloat(this.contracts[this.quote].portfolioTot);
    if (1/multiple > 2 && this.defensiveSkew){
      multiple = 1/multiple;
      defensiveSkew = multiple < 6 ? this.defensiveSkew * Math.floor(multiple-1) : this.defensiveSkew * 5
    }
    let askSpread = this.askSpread + defensiveSkew + slip;
    console.log("Ask Spread:",askSpread);
    return askSpread;
  }

  // Update the marketPrice from price feed bot
  async getNewMarketPrice() {
    try {
      let response = await axios.get('http://localhost:3000/prices');
      let prices = response.data;
      

      if (this.base == "sAVAX"){
        this.quoteUsd = prices[this.quote+'-USD']; 
        this.baseUsd = prices['sAVAX-AVAX'] * this.quoteUsd; 
      } else {
        this.baseUsd = prices[this.base+'-USD']; 
        this.quoteUsd = prices[this.quote+'-USD']; 
      }
      if (this.baseUsd && this.quoteUsd){
        this.marketPrice = new BigNumber(this.baseUsd/this.quoteUsd);
        console.log("new market Price:",this.marketPrice.toNumber());
      } else {
        throw 'trouble getting base or quote prices'
      }
    } catch (error: any) {
      this.logger.error(`${this.instanceName} Error during getNewMarketPrice`, error);
    }
    return this.marketPrice;
  }

  refreshLevel(level:number,isBid : boolean): boolean {
    if (level == 1){
      return true;
    }
    let lastUpdateBid = this.independentLevels[level.toString()].lastUpdateBid;
    let lastUpdateAsk = this.independentLevels[level.toString()].lastUpdateAsk;
    console.log("level:",level,"isBid",isBid,"lastUpdateBid",lastUpdateBid,"lastUpdateAsk",lastUpdateAsk);
    if (isBid){
      return !lastUpdateBid || Math.abs(lastUpdateBid - this.marketPrice.toNumber()) / lastUpdateBid > this.independentLevels[level.toString()].tolerance/100;
    } else {
      return !lastUpdateAsk || Math.abs(lastUpdateAsk - this.marketPrice.toNumber()) / lastUpdateAsk > this.independentLevels[level.toString()].tolerance/100;
    }
  }

  setLevelRefreshPrice(level:number,isBid:boolean){
    if (level == 1){
      return;
    }
    if (isBid){
      this.independentLevels[level.toString()].lastUpdateBid = this.marketPrice.toNumber();
    } else {
      this.independentLevels[level.toString()].lastUpdateAsk = this.marketPrice.toNumber();
    }
  }

  // not used
  getPrice(side: number): BigNumber {
    return this.marketPrice;
  }

  async getAlotPrice(): Promise<number> {
    let alotprice = 0.25;
    try {
      alotprice = 0.25; // FIXME Implement your own price source to get the ALOT price
    } catch (error) {
      this.logger.error(`${this.instanceName} Error during getAlotPrice`, error);
    }
    return alotprice;
  }

  // NOT USED
  getBaseCapital(): number {
    if (this.baseUsd) {
      return parseFloat((this.capitalASideUSD / this.baseUsd).toFixed(this.baseDisplayDecimals));
    } else {
      return this.initialDepositBase;
    }
  }

  // NOT USED
  getQuoteCapital(): number {
    if (this.quoteUsd) {
      return parseFloat((this.capitalASideUSD / this.quoteUsd).toFixed(this.quoteDisplayDecimals));
    } else {
      return this.initialDepositQuote;
    }
  }

  // returns one tick based on quoteDisplayDecimals
  getIncrement(): number {
    let increment = 1 / (Math.pow(10,this.quoteDisplayDecimals));
    return increment;
  }

}

const sortOrders = (arr: any, propertyName: any, order: string = 'ascending') => {
  const sortedArr = arr.sort((a: any, b: any) => {
    if (a[propertyName] < b[propertyName]) {
      return -1;
    }
    if (a[propertyName] > b[propertyName]) {
      return 1;
    }
    return 0;
  });

  if (order === 'descending') {
    return sortedArr.reverse();
  }

  return sortedArr;
};

export default MarketMakerBot;
