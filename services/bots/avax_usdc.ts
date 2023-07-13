import axios from "axios";
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import NewOrder from "./classes";
import Order from "../../models/order";
import { error } from "console";
import { BrotliDecompress } from "zlib";

class avax_usdc extends AbstractBot {
  protected marketPrice = new BigNumber(17); //AVAX/USDC
  protected baseUsd = 13; //AVAX
  protected quoteUsd = 1; //USDC
  protected capitalASideUSD = 300;
  protected counter = 0;

  constructor(botId: number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
    // Will try to rebalance the amounts in the Portfolio Contract
    this.portfolioRebalanceAtStart = false;
    this.bidSpread = 0.3;
    this.askSpread = 0.3;
    this.orderLevels = 2;
    this.orderLevelSpread = 0.1;
    this.orderLevelQty = BigNumber(2); 
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
      await this.getNewMarketPrice();

      this.interval = 15000; //Min 10 seconds

      // this.minTradeAmnt = this.pairObject.mintrade_amnt * 1.1;
      // this.maxTradeAmnt = this.pairObject.mintrade_amnt * 5;

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
        await utils.sleep(3000);
      }
      
      this.logger.debug(`${JSON.stringify(this.getOrderBook())}`);
      //const bookinChain = await this.getBookfromChain();

      //Get rid of any order that is outstanding on this account if needed.
      //if you have more than 10-15 outstanding orders on this pair, this function may run out of gas
      // use this.cancelAllIndividually() instead.
      await this.cancelOrderList([], 100);

      // ------------ Create and Send Initial Order List ------------ //
      let levels : number[][] = [];
      for (let i = 1; i <= this.orderLevels; i++){
        levels.push([0,i]);
        levels.push([1,i]);
      }

      await this.placeInitialOrders(levels);

      // ------------ Begin Order Updater ------------ //

      this.orderUpdater = setTimeout(()=>{
        this.updateOrders();
      }, this.interval/2);

    } else {
      this.logger.warn(`${this.instanceName} Bot Status set to false, will not send orders`);
    }
  }

  async updateOrders() {
    if (this.orderUpdater != undefined) {
      clearTimeout(this.orderUpdater);
    }

    try {
      this.counter ++;
      console.log("000000000000000 COUNTER:",this.counter);
      
      const marketPrice = this.getPrice(1).toNumber();
      const startingBidPrice = marketPrice * (1-this.bidSpread/100);
      const startingAskPrice = marketPrice * (1+this.askSpread/100);


      let bids: object[] = []; 
      let asks: object[] = [];

      this.orders.forEach((e,i)=>{
        if (e.side === 0){
          bids.push({side:e.side,id:e.id,price:e.price.toNumber(),level:e.level,status:e.status, totalamount:e.totalamount,quantityfilled:e.quantityfilled});
        } else {
          asks.push({side:e.side,id:e.id,price:e.price.toNumber(),level:e.level,status:e.status, totalamount:e.totalamount,quantityfilled:e.quantityfilled});
        }
      })      
    
      let bidsSorted = sortOrders(bids, "price", "descending");
      let asksSorted = sortOrders(asks, "price", "ascending");

      this.replaceBids(bidsSorted, startingBidPrice);
      this.replaceAsks(asksSorted, startingAskPrice);

    } catch (error) {
      this.logger.error(`${this.instanceName} Error in UpdateOrders`, error);
      this.cleanUpAndExit();
    } finally {
      //Update orders again after interval
      this.orderUpdater = setTimeout(async ()=>{
        this.cleanUpAndExit();
        // await this.getNewMarketPrice();
        // this.updateOrders();
      }, this.interval);
    }
  }

  // Takes in an array of arrays. The first number of each subarray is the side, the second is the level.
  // For each subarray passed in, it creates a new order and adds it to newOrderList. At the end it calls addLimitOrderList with the newOrderList
  async placeInitialOrders(levels: number[][]){

    const marketPrice = this.getPrice(1).toNumber();
    const initialBidPrice = marketPrice * (1-this.bidSpread/100);
    const initialAskPrice = marketPrice * (1+this.askSpread/100);
    let newOrderList : NewOrder[] = [];
    // --------------- SET BIDS --------------- //
    let bidsEnroute = 0;
    let asksEnRoute = 0;
    for (let x = 0; x < levels.length; x++){
      if (levels[x][0] == 0){
        let bidPrice = new BigNumber(initialBidPrice * (1-(levels[x][1]*this.orderLevelSpread/100)));
        let bidQty = new BigNumber(this.getQty(bidPrice,0,levels[x][1],this.contracts[this.quote].portfolioTot - (bidsEnroute * bidPrice.toNumber())));
        if (bidQty.toNumber() * bidPrice.toNumber() > this.minTradeAmnt){
          console.log("BID LEVEL ",levels[x][0],": BID PRICE: ", bidPrice.toNumber(),", BID QTY: ",bidQty.toNumber(), "Portfolio Tot: ",this.contracts[this.quote].portfolioTot);
          bidsEnroute += bidQty.toNumber();
          newOrderList.push(new NewOrder(0,bidQty,bidPrice,levels[x][1]));
        }
      } else {
      //--------------- SET ASKS --------------- //
        let askPrice = new BigNumber(initialAskPrice * (1+(levels[x][1]*this.orderLevelSpread/100)));
        let askQty = new BigNumber(this.getQty(askPrice,1,levels[x][1],this.contracts[this.base].portfolioTot - asksEnRoute));
        if (askQty.toNumber() * askPrice.toNumber() > this.minTradeAmnt){
          console.log("ASK LEVEL ",levels[x][1],": ASK PRICE: ", askPrice.toNumber(),", ASK QTY: ",askQty.toNumber(), "Portfolio Tot: ",this.contracts[this.base].portfolioTot);
          asksEnRoute += askQty.toNumber();
          newOrderList.push(new NewOrder(1,askQty,askPrice,levels[x][1]));
        }
      }
    }

  //   // --------------- EXECUTE ORDERS --------------- //
    await this.addLimitOrderList(newOrderList);
  }

  async replaceBids(bidsSorted: any, startingBidPrice: number){
    console.log("REPLACE BIDS: ",bidsSorted.length);
    let bidsEnRoute = 0;
    let timer = 0;
    for (let i = 0; i < this.orderLevels; i ++){
      let order = {id:null, status:null, totalamount:new BigNumber(0),quantityfilled:new BigNumber(0)};
      for (let j = 0; j < bidsSorted.length; j++){
        if (bidsSorted[j].level == i+1){
          order = bidsSorted[j];
          console.log("BID ORDER: ", order);
        }
      }
      // We need a timer because you cannot replace or make multiple individual orders on the same pair on the same side in one block
      setTimeout(()=>{
        timer += 3000;
        if (order.id && (order.status == 0 || order.status == 2 || order.status == 7)){
          let bidPrice = new BigNumber(0.99 * startingBidPrice * (1-(i*this.orderLevelSpread/100)));
          let bidQty = new BigNumber(this.getQty(bidPrice,0,i+1,this.contracts[this.quote].portfolioTot + (bidPrice.toNumber() * (order.totalamount.toNumber() - order.quantityfilled.toNumber())) - (bidsEnRoute * bidPrice.toNumber())));
          if (bidQty.toNumber() * bidPrice.toNumber() > this.minTradeAmnt){
            bidsEnRoute += (bidQty.toNumber() - (order.totalamount.toNumber() - order.quantityfilled.toNumber()));
            console.log("REPLACE ORDER:",bidPrice,bidQty);
            this.cancelReplaceOrder(order,bidPrice,bidQty);
          } else {
            console.log("NOT ENOUGH FUNDS TO REPLACE", bidQty.toNumber() * bidPrice.toNumber(), this.contracts[this.quote].portfolioTot, order.totalamount.toNumber(), order.quantityfilled.toNumber(), bidsEnRoute);
          }
        } else {
          console.log("MAKE FRESH ORDER");
          this.placeInitialOrders([[0,i+1]]);
        }
      },0);
    }
  }

  async replaceAsks (asksSorted: any, startingAskPrice: number){
    console.log("REPLACE ASKS: ",asksSorted.length);
    let asksEnRoute = 0;
    let timer = 0;

    for (let i = 0; i < this.orderLevels; i ++){
      let order = {id:null, status:null, totalamount:new BigNumber(0),quantityfilled:new BigNumber(0)};
      for (let j = 0; j < asksSorted.length; j++){
        if (asksSorted[j].level == i+1){
          order = asksSorted[j];
          console.log("ASK ORDER: ", order);
        }
      }
      // We need a timer because you cannot replace or make multiple individual orders on the same pair on the same side in one block
      setTimeout(()=>{
        timer += 3000;
        if (order.id && (order.status == 0 || order.status == 2 || order.status == 7)){
          let askPrice = new BigNumber(1.01 * startingAskPrice * (1-(i*this.orderLevelSpread/100)));
          let askQty = new BigNumber(this.getQty(askPrice,1,i+1,this.contracts[this.base].portfolioTot + (order.totalamount.toNumber() - order.quantityfilled.toNumber()) - asksEnRoute));
          if (askQty.toNumber() * askPrice.toNumber() > this.minTradeAmnt){
            asksEnRoute += (askQty.toNumber() - (order.totalamount.toNumber() - order.quantityfilled.toNumber()));
            console.log("REPLACE ORDER:",askPrice,askQty);
            this.cancelReplaceOrder(order,askPrice,askQty);
          } else {
            console.log("NOT ENOUGH FUNDS TO REPLACE", askQty.toNumber(), this.contracts[this.base].portfolioTot, order.totalamount.toNumber(), order.quantityfilled.toNumber(), asksEnRoute);
          }
        } else {
          console.log("MAKE FRESH ORDER");
          this.placeInitialOrders([[1,i+1]]);
        }
      },0);
    }
  }

  // Takes in price, side, level, and availableFunds. Returns amount to place.
  // If there are enough availableFunds, it will return the intended amount according to configs, otherwise it will return as much as it can, otherwise it will return 0
  getQty(price: BigNumber, side: number, level: number, availableFunds: number): number {
    if (side === 0){
      console.log("AVAILABLE FUNDS IN QUOTE BID: ",availableFunds, "AMOUNT: ",(level) * this.orderLevelQty.toNumber())
      if ((level) * this.orderLevelQty.toNumber() < availableFunds){
        return (level) * this.orderLevelQty.toNumber();
      } else if (availableFunds > this.minTradeAmnt * 1.025){
        return availableFunds*.975;
      } else { return 0;}
    } else if (side === 1) {
      console.log("AVAILABLE FUNDS ASK: ",availableFunds, "AMOUNT: ",(level) * this.orderLevelQty.toNumber())
      if ((level) * this.orderLevelQty.toNumber() < availableFunds){
          return (level) * this.orderLevelQty.toNumber();
      } else if (availableFunds > this.minTradeAmnt * 1.025){
        return availableFunds * .975;
      } else {return 0;}
    } else { 
      return 0; // function declaration requires I return a number
    }
  }

  getPrice(side: number): BigNumber {
    return this.marketPrice;
  }

  // Update the marketPrice from an outside source
  async getNewMarketPrice() {
    try {
      let response_base = await axios.get('http://localhost/'+this.base);
      this.baseUsd = response_base.data; //AVAX
      
      let response_quote = await axios.get('http://localhost/'+this.quote);
      this.quoteUsd = response_quote.data; //USDC

      if (!this.baseUsd){
        this.baseUsd = 12;
      }
      if (!this.quoteUsd){
        this.quoteUsd = 1;
      }

      this.setMarketPrice(this.baseUsd/this.quoteUsd);
    } catch (error: any) {
      this.logger.error(`${this.instanceName} Error during getNewMarketPrice`, error);
    }
    return this.marketPrice;
  }

  setMarketPrice(price: number) {
    this.marketPrice = new BigNumber(price);
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

export default avax_usdc;
