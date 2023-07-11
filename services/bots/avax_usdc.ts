import axios from "axios";
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import NewOrder from "./classes";
import { error } from "console";

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
    this.orderLevelSpread = 0.05;
    this.orderLevelQty = BigNumber(10); 
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
      await this.getNewMarketPrice();

      this.interval = 10000; //Min 10 seconds

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
      await this.placeInitialOrders()

      // ------------ Begin Order Updater ------------ //

      this.updateOrders();

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
      const initialBidPrice = marketPrice * (1-this.bidSpread/100);
      const initialAskPrice = marketPrice * (1+this.askSpread/100);

      let bids = sortOrders(this.orderbook.state().bids, "price", "descending");
      let asks = sortOrders(this.orderbook.state().asks, "price", "ascending");

      let baseEnRoute = 0;
      let quoteEnRoute = 0;

      if (bids.length < this.orderLevels){
        this.placeInitialOrders(true,false);
      } else {
        bids.forEach((e: any,i: number) => {
          let bidPrice = new BigNumber(initialBidPrice * (1-(i*this.orderLevelSpread/100)));
          let bidQty = new BigNumber(this.getQty(bidPrice,0,i,this.contracts[this.base].portfolioTot + (e.quantity * bidPrice.toNumber()) - quoteEnRoute));
          if (bidQty.toNumber() * bidPrice.toNumber() > this.minTradeAmnt){
            quoteEnRoute += bidQty.toNumber();
            this.cancelReplaceOrder(e,bidPrice,bidQty);
          } else {
            return;
          }
        })
      }

      if (asks.length < this.orderLevels){
        this.placeInitialOrders(false,true);
      } else {
        asks.forEach((e: any,i: number) => {
          let askPrice = new BigNumber(initialAskPrice * (1+(i*this.orderLevelSpread/100)));
          let askQty = new BigNumber(this.getQty(askPrice,1,i,this.contracts[this.quote].portfolioTot + e.quantity - baseEnRoute));
          if (askQty.toNumber() * askPrice.toNumber() > this.minTradeAmnt){
            baseEnRoute += askQty.toNumber();
            this.cancelReplaceOrder(e,askPrice,askQty);
          }
        })
      }

        

      this.logger.debug(`orderbook:${JSON.stringify(this.getOrderBook())}`);
      
    } catch (error) {
      this.logger.error(`${this.instanceName} Error in UpdateOrders`, error);
      process.exit(1);
    } finally {
      
      // Wait before updating orders again
      await utils.sleep(this.interval);
      await this.cancelOrderList([], 100);
      //Update Orders Again
      this.updateOrders();
    }
  }

  async placeInitialOrders(setBids: boolean = true, setAsks: boolean = true){
    const marketPrice = this.getPrice(1).toNumber();
    const initialBidPrice = marketPrice * (1-this.bidSpread/100);
    const initialAskPrice = marketPrice * (1+this.askSpread/100);
    let newOrderList : NewOrder[] = [];
    // --------------- SET BIDS --------------- //
    if (setBids){
      let bidsEnroute = 0;
      for (let i = 0; i < this.orderLevels; i++) {
        let bidPrice = new BigNumber(initialBidPrice * (1-(i*this.orderLevelSpread/100)));
        let bidQty = new BigNumber(this.getQty(bidPrice,0,i,this.contracts[this.quote].portfolioTot - (bidsEnroute * bidPrice.toNumber())));
        if (bidQty.toNumber() * bidPrice.toNumber() > this.minTradeAmnt){
          bidsEnroute += bidQty.toNumber();
          console.log("BID LEVEL ",i,": BID PRICE: ", bidPrice.toNumber(),", BID QTY: ",bidQty.toNumber(), "Portfolio Tot: ",this.contracts[this.quote].portfolioTot);
          newOrderList.push(new NewOrder(0,bidQty,bidPrice));
        }
      }
    }

    // --------------- SET ASKS --------------- //
    if (setAsks){
      let asksEnRoute = 0;
      for (let i = 0; i < this.orderLevels; i++) {
        let askPrice = new BigNumber(initialAskPrice * (1+(i*this.orderLevelSpread/100)));
        let askQty = new BigNumber(this.getQty(askPrice,1,i,this.contracts[this.base].portfolioTot - asksEnRoute));
        console.log("ASK LEVEL ",i,": ASK PRICE: ", askPrice.toNumber(),", ASK QTY: ",askQty.toNumber(), "Portfolio Tot: ",this.contracts[this.base].portfolioTot);
        if (askQty.toNumber() * askPrice.toNumber() > this.minTradeAmnt){
          asksEnRoute += askQty.toNumber();
          newOrderList.push(new NewOrder(1,askQty,askPrice));
        }
      }
    }
    
    console.log("NEW ORDER LIST:",newOrderList);
    // --------------- EXECUTE ORDERS --------------- //
    await this.addLimitOrderList(newOrderList);
  }

  getQty(price: BigNumber, side: number, level: number, availableFunds: number): number {
    if (side === 0){
      console.log("AVAILABLE FUNDS IN QUOTE BID: ",availableFunds, "AMOUNT: ",(level+1) * this.orderLevelQty.toNumber())
      if ((level+1) * this.orderLevelQty.toNumber() < availableFunds){
        return (level+1) * this.orderLevelQty.toNumber();
      } else if (availableFunds > this.minTradeAmnt * 1.1){
        return availableFunds*.9;
      } else { return 0;}
    } else if (side === 1) {
      console.log("AVAILABLE FUNDS ASK: ",availableFunds, "AMOUNT: ",(level+1) * this.orderLevelQty.toNumber())
      if ((level+1) * this.orderLevelQty.toNumber() < availableFunds){
          return (level+1) * this.orderLevelQty.toNumber();
      } else if (availableFunds * price.toNumber() > this.minTradeAmnt * 1.1){
        return availableFunds * .9;
      } else {return 0;}
    } else { return 0;}
  }

  getPrice(side: number): BigNumber {
    return this.marketPrice;
  }

  // Update the marketPrice from an outside source
  async getNewMarketPrice() {
    try {
      // let response_avax = await axios.get('http://localhost/avax_usd');
      this.baseUsd = 12; //response_avax.data; //AVAX
      
      // let response_usdc = await axios.get('http://localhost/usdc_usd');
      this.quoteUsd = 1; //response_usdc.data; //USDC

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
