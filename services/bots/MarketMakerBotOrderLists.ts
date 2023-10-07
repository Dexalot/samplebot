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
  protected timer: any;
  protected lastBaseUsd: any;
  protected lastUpdate: any;

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
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
      await this.getNewMarketPrice();

      this.interval = 15000; //Min 10 seconds

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

      await this.correctNonce(this.contracts["SubNetProvider"]);
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

  async updateOrders() {
    if (this.orderUpdater != undefined) {
      clearTimeout(this.orderUpdater);
    }

    try {
      console.log(Date.now(), this.lastUpdate)
      if (this.status && ((Date.now() - this.lastUpdate)/1000 > 20 || this.marketPrice.toNumber()<this.lastMarketPrice.toNumber()*(1-parseFloat(this.refreshOrderTolerance)) || this.marketPrice.toNumber()>this.lastMarketPrice.toNumber()*(1+parseFloat(this.refreshOrderTolerance)))){
        this.orderUpdaterCounter ++;
        this.lastUpdate = Date.now();
        this.timer = this.interval;
        console.log("000000000000000 COUNTER:",this.orderUpdaterCounter);
        
        // Refresh orders, balances, and get new best bid and ask prices
        await Promise.all([this.correctNonce(this.contracts["SubNetProvider"]),this.processOpenOrders(),this.getBalances(),this.getBestOrders()]);

        // Cancel all orders, when finished, trigger the new order placement.
        const promise = Promise.resolve(this.cancelOrderList([], 100));

        if (this.baseUsd && this.quoteUsd){
          // ------------ Create new Order List ------------ //
          let levels : number[][] = [];
          for (let i = 1; i <= this.orderLevels; i++){
            levels.push([0,i]);
            levels.push([1,i]);
          }

          // Gets all order records
          let bids: any[] = []; 
          let asks: any[] = [];
          let duplicates: any[] = [];
  
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
        
          // This code finds how much funds are currently on open orders which you're cancelling so that it can determine how much is available for new orders
          let onBids = 0;
          let onAsks = 0;
          for (let i = 0; i < bids.length;i++){
            let order = bids[i];
            let amountOnOrder = (order.quantity.toNumber()-order.quantityfilled.toNumber())*order.price.toNumber() * 0.999;
            onBids+= amountOnOrder;
          }
          for (let i = 0; i < asks.length;i++){
            let order = asks[i];
            let amountOnOrder = (order.quantity.toNumber()-order.quantityfilled.toNumber()) * 0.999;
            onAsks+= amountOnOrder;
          }
          // finally, we correct the nonce one last time and then create and send the new orders
          promise.then(async()=>{
            await this.correctNonce(this.contracts["SubNetProvider"])
            await this.placeInitialOrders(levels, parseFloat(this.contracts[this.quote].portfolioAvail) + onBids, parseFloat(this.contracts[this.base].portfolioAvail) + onAsks);
          })
        }
          
        this.lastMarketPrice = this.marketPrice;
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

    let initialBidPrice = parseFloat((this.marketPrice.toNumber() * (1-this.bidSpread)).toFixed(this.quoteDisplayDecimals));
    let initialAskPrice = parseFloat((this.marketPrice.toNumber() * (1+this.askSpread)).toFixed(this.quoteDisplayDecimals));
    initialBidPrice = this.currentBestAsk && this.currentBestAsk <= initialBidPrice ? this.currentBestAsk - this.getIncrement() : initialBidPrice;
    initialAskPrice = this.currentBestBid && this.currentBestBid >= initialAskPrice ? this.currentBestBid + this.getIncrement() : initialAskPrice;

    let newOrderList : NewOrder[] = [];
    // --------------- SET BIDS --------------- //
    for (let x = 0; x < levels.length; x++){
      if (levels[x][0] == 0){
        let bidPrice = new BigNumber((initialBidPrice * (1-this.getSpread(levels[x][1]-1))).toFixed(this.quoteDisplayDecimals));
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
        let askPrice = new BigNumber((initialAskPrice * (1+this.getSpread(levels[x][1]-1))).toFixed(this.quoteDisplayDecimals));
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
    if (newOrderList.length == 0){
      console.log("ERROR - NewOrderList empty");
    } else if (newOrderList.length == 1){
      if (this.status){
        this.addOrder(newOrderList[0].side,newOrderList[0].quantity,newOrderList[0].price,1,3,newOrderList[0].level);
      }
    } else {
      if (this.status){
        console.log("PLACING INITAL ORDERS: ",levels);
        this.addLimitOrderList(newOrderList);
      }
    }
    
    this.lastUpdate = Date.now();
  }

  // Takes in price, side, level, and availableFunds. Returns amount to place.
  // If there are enough availableFunds, it will return the intended amount according to configs, otherwise it will return as much as it can, otherwise it will return 0
  getQty(price: BigNumber, side: number, level: number, availableFunds: number): number {
    if (side === 0){
      console.log("AVAILABLE FUNDS IN QUOTE BID: ",availableFunds, "AMOUNT: ",this.getLevelQty(level))
      if (this.getLevelQty(level) < availableFunds/price.toNumber()){
        return this.getLevelQty(level);
      } else if (availableFunds > this.minTradeAmnt * 2){
        return availableFunds/price.toNumber() * .999;
      } else { return 0;}
    } else if (side === 1) {
      console.log("AVAILABLE FUNDS ASK: ",availableFunds, "AMOUNT: ",this.getLevelQty(level))
      if (this.getLevelQty(level) < availableFunds){
          return this.getLevelQty(level);
      } else if (availableFunds * price.toNumber() > this.minTradeAmnt * 2){
        return availableFunds * .999;
      } else {return 0;}
    } else { 
      return 0; // function declaration requires I return a number
    }
  }

  getLevelQty(level:number):number{
    return parseFloat(this.flatAmount) + (parseFloat(this.orderLevelQty) * (level-1));
  }

  getSpread(level:number):number{
    return (level*parseFloat(this.orderLevelSpread))
  }

  // Update the marketPrice from an outside source
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

  getBaseCapital(): number {
    if (this.baseUsd) {
      return parseFloat((this.capitalASideUSD / this.baseUsd).toFixed(this.baseDisplayDecimals));
    } else {
      return this.initialDepositBase;
    }
  }

  getQuoteCapital(): number {
    if (this.quoteUsd) {
      return parseFloat((this.capitalASideUSD / this.quoteUsd).toFixed(this.quoteDisplayDecimals));
    } else {
      return this.initialDepositQuote;
    }
  }

  getIncrement(): number {
    let increment = '0.';
    for (let i = 0; i < this.quoteDisplayDecimals; i++){
      if (i < this.quoteDisplayDecimals - 1){
        increment += '0'
      } else {
        increment += '1'
      }
    }
    return parseFloat(increment);
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
