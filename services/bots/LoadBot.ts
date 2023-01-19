
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
class LoadBot extends AbstractBot{

  protected marketPrice =new BigNumber(17); //AVAX/USDC
  protected baseUsd= 17;  //AVAX
  protected quoteUsd= 1; //USDC
  protected capitalASideUSD=300;

  constructor(botId:number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
    // Do not rebalance the portfolio. The tokens are expected to be in the subnet already
    this.portfolioRebalanceAtStart= "N";

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
      // Enable the next line if you need the bot to run continuously
      // this.orderUptader = setTimeout( () => this.updateOrders(), this.interval );
      // Comment out if you need the bot to run continuously
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

      await this.cancelAll();

      // Sleep 30 seconds initially
      await utils.sleep(3000);

      await this.addLimitOrderList();

      await utils.sleep(1000);

      this.logger.debug (`${JSON.stringify(this.getOrderBook())}`);

  } catch (error){
    this.logger.error (`${this.instanceName} Error in UpdateOrders`, error);
    process.exit(1);
  } finally {
    //  Enable the next line if you need the bot to run continuously
    this.startOrderUpdater();
  }
}

  getQuantity(price:BigNumber, side:number) {
    return new BigNumber(this.minTradeAmnt).div(price);
  }

  async getPrice (side:number): Promise<BigNumber> {
    return this.marketPrice;
  }

  // Update the marketPrice from an outside source
  async getNewMarketPrice() {
      try {
        // TODO Implement your own price source to get the Base & Quote price from an external source if necessary

        // this.setMarketPrice(PriceService.prices[this.priceSymbolPair.pair]);
        // this.baseUsd = PriceService.prices[this.priceSymbolPair.base];
        // this.quoteUsd = PriceService.prices[this.priceSymbolPair.quote];

        this.baseUsd = 17;  //AVAX
        this.quoteUsd= 1; //USDC

      } catch (error:any) {
        this.logger.error (`${this.instanceName} Error during getNewMarketPrice`, error);
      }
    return this.marketPrice;
  }

  setMarketPrice(price:number) {
    this.marketPrice = new BigNumber(price);
  }

  async getAlotPrice (): Promise<number> {
    let alotprice = 0.25;
    try {
     alotprice = 0.25; // FIXME Implement your own price source to get the ALOT price
    } catch (error) {
      this.logger.error (`${this.instanceName} Error during getAlotPrice`, error);
    }
    return alotprice;
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

export default LoadBot;
