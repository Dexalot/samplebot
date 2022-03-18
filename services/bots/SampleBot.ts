
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";

class SampleBot extends AbstractBot{

  protected marketPrice =new BigNumber(95); //AVAX/USDT
  protected baseUsd:number= 90;  //AVAX
  protected quoteUsd:number= 1; //USDT
  protected capitalASideUSD=5000;

  constructor(botId:number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info (`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize (): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing){
      await this.getNewMarketPrice();

      this.interval =  10000 //Min 10 seconds

      this.minTradeAmnt = this.pairObject.mintrade_amnt * 1.1 ;
      this.maxTradeAmnt = this.pairObject.mintrade_amnt * 5;

      // PNL  TO KEEP TRACK OF PNL , FEE & TCOST  etc
      //this.PNL = new PNL(getConfig('NODE_ENV_SETTINGS'), this.instanceName, this.base, this.quote, this.config, this.account);

      return true;
    } else {
      return false;
    }

  }


  async startOrderUpdater  ()  {
    if (this.status) {
      // this.orderUptader = setTimeout( () => this.updateOrders(), this.interval );
      this.updateOrders();
    } else {
      this.logger.warn (`${this.instanceName} Bot Status set to false, will not send orders`);
    }
  }

  async updateOrders () {
    if (this.orderUptader != undefined){
      clearTimeout(this.orderUptader);
    }

    try {

      //Get rid of any order that is outstanding on this account
      //Bot automatically recovers any active orders from DB
      //await this.cancelAll();
      //await utils.sleep(3000);

      const nbrofOrders = 4;
      const halfofOrders = nbrofOrders/2;
      const quantity = new BigNumber(4);

      console.log (this.instanceName, 'Sending & Cancelling', nbrofOrders, 'orders at different prices');
      let i;
      for (i=0; i < halfofOrders ; i++) {
        await this.addOrder(utils.sideMap.BUY, quantity, new BigNumber(i/100 + 120));
      }

      for (i=0; i < halfofOrders ; i++) {
        await this.addOrder(utils.sideMap.SELL,quantity, new BigNumber(i/100 + 122));
      }
      await this.cancelAllIndividually();
      await utils.sleep(3000);


      // console.log (this.instanceName, 'Sending & Filling', nbrofOrders, 'orders');
      // for (i=0; i < nbrofOrders ; i++) {
      //   await this.addOrder(utils.sideMap.BUY,quantity, new BigNumber(i/100 + 120));
      // }

      // for (i=0; i < nbrofOrders ; i++) {
      //   await this.addOrder(utils.sideMap.SELL,quantity,new BigNumber(i/100 + 120));
      // }
      // await utils.sleep(3000);



      // for (i=0; i < nbrofOrders ; i++) {
      //   await this.addOrder(utils.sideMap.SELL, quantity, undefined, 0); // Send Market Orders
      // }

      // await utils.sleep(1000);
      process.exit(0);

  } catch (error){
    this.logger.error (`${this.instanceName} Error in UpdateOrders`, error);
    process.exit(1);
  } finally {
    // enable if loop needed
    // this.startOrderUpdater();
  }
}

  async getQuantity(price:BigNumber, side:number) {
    return new BigNumber(this.minTradeAmnt).div(price);
  }

  async getPrice (side:number): Promise<BigNumber> {
    return this.marketPrice;
  }

  // Update the marketPrice from an outside source
  async getNewMarketPrice() {
      try {
        // this.setMarketPrice(PriceService.prices[this.priceSymbolPair.pair]);
        // this.baseUsd = PriceService.prices[this.priceSymbolPair.base];
        // this.quoteUsd = PriceService.prices[this.priceSymbolPair.quote];
      } catch (error:any) {
        this.logger.error (`${this.instanceName} Error during getNewMarketPrice`, error);
      }
    return this.marketPrice;
  }

  setMarketPrice(price:number) {
    this.marketPrice = new BigNumber(price);
  }

  async getAvaxPrice (): Promise<number> {
    var avaxprice = 0;
    try {
     avaxprice = 95; // FIXME
    } catch (error) {
      this.logger.error (`${this.instanceName} Error during getAvaxPrice`, error);
    }
    return avaxprice;
   }

  getBaseCapital () : number {
    if (this.baseUsd) {
      return parseFloat((this.capitalASideUSD / this.baseUsd).toFixed(this.baseDisplayDecimals));
    } else {
      return this.initialDepositBase;
    }
  }

  getQuoteCapital (): number {
    if (this.quoteUsd) {
      return parseFloat((this.capitalASideUSD / this.quoteUsd).toFixed(this.quoteDisplayDecimals));
    } else {
      return this.initialDepositQuote;
    }
  }



}

export default SampleBot;
