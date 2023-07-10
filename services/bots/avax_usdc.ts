import axios from "axios";
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import NewOrder from "./classes";

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
    this.orderLevelQty = 0.5; 
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
      
      const nbrofOrders = this.orderLevels * 2;
      const halfofOrders = nbrofOrders / 2;
      const quantity = new BigNumber(0.5);
      const marketPrice = this.getPrice(1).toNumber();
      const initialBidPrice = marketPrice * (1-this.bidSpread/100);
      const initialAskPrice = marketPrice * (1+this.askSpread/100);

      let newOrderList : NewOrder[] = [];
      for (let i = 0; i < halfofOrders; i++) {
        let bidPrice =  new BigNumber(initialBidPrice * (1-(i*this.orderLevelSpread/100)));
        newOrderList.push(new NewOrder(0,quantity,bidPrice));
      }
      for (let i = 0; i < halfofOrders; i++) {
        let askPrice = new BigNumber(initialAskPrice * (1+(i*this.orderLevelSpread/100)))
        newOrderList.push(new NewOrder(1,quantity,askPrice));
      }

      this.addLimitOrderList(newOrderList);

      // ------------ Begin Order Updater ------------ //

      this.updateOrders();

    } else {
      this.logger.warn(`${this.instanceName} Bot Status set to false, will not send orders`);
    }
  }

  async updateOrders() {
    if (this.orderUptader != undefined) {
      clearTimeout(this.orderUptader);
    }

    try {
      console.log("000000000000000 COUNTER:",this.counter);
      this.counter ++;

      this.logger.debug(`orderbook:${JSON.stringify(this.getOrderBook())}`);
      
    } catch (error) {
      this.logger.error(`${this.instanceName} Error in UpdateOrders`, error);
      process.exit(1);
    } finally {
      
      // Wait before updating orders again
      await utils.sleep(this.interval);
      //Update Orders Again
      this.updateOrders();
    }
  }

  getQuantity(price: BigNumber, side: number) {
    return new BigNumber(this.minTradeAmnt).div(price);
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

export default avax_usdc;
