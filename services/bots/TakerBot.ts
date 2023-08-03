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
  protected bidSpread: any;
  protected askSpread: any;
  protected flatAmount: any;
  protected timer: any;
  protected capitalASideUSD = 300;

  constructor(botId: number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
    // Will try to rebalance the amounts in the Portfolio Contract
    this.portfolioRebalanceAtStart = false;
    this.config = getConfig(this.tradePairIdentifier);
    this.config = this.config.taker;
    this.bidSpread = this.config.bidSpread/100;
    this.askSpread = this.config.askSpread/100;
    this.flatAmount = this.config.flatAmount;
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
      await this.getNewMarketPrice();
      // await this.getBestOrders();

      this.interval = 5000;

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

        await this.getBestOrders();

        // ------------ Begin Order Updater ------------ //

        this.orderUpdater = setTimeout(()=>{
          this.updateOrders();
        }, this.interval/2);
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
    if (this.orders.values.length > 0){
        await this.cancelOrderList([],100);
        this.timer = 6000;
    }

    try {
      if (this.status && (this.marketPrice.toNumber() * (1 - this.bidSpread) > this.currentBestAsk || this.marketPrice.toNumber() * (1 + this.askSpread) > this.currentBestBid)){
        this.timer = this.interval;

        // having issues with nonces when avax/usdc and avax/usdt send orders at the same time in the same wallet. This gives priority to avaxusdc.
        if (this.tradePairIdentifier == "AVAX/USDt"){
            await utils.sleep(500);
        }
        await Promise.all([this.getBalances(),this.correctNonce(this.contracts["SubNetProvider"])]);

        if (this.marketPrice.toNumber() * (1 - this.bidSpread) > this.currentBestAsk){
            const bidPrice = new BigNumber(this.marketPrice.toNumber() * (1 - this.bidSpread));
            let quantity = this.getQuantity(bidPrice, 0);
            this.addOrder(0,quantity,bidPrice,1,2,0); // immediate or cancel order
        }
        if (this.marketPrice.toNumber() * (1 + this.askSpread) < this.currentBestBid){
            const askPrice = new BigNumber(this.marketPrice.toNumber() * (1 + this.askSpread));
            let quantity = this.getQuantity(askPrice, 1);
            this.addOrder(1,quantity,askPrice,1,2,0); // immediate or cancel order
        }


        }
    } catch (error) {
      this.logger.error(`${this.instanceName} Error in UpdateOrders`, error);
      this.cleanUpAndExit();
    } finally {
      //Update orders again after interval
      this.orderUpdater = setTimeout(async ()=>{
        if (this.status){
          await Promise.all([this.getNewMarketPrice(),this.getBestOrders(),this.processOpenOrders()]);
          this.timer = 2000;
          this.updateOrders();
        }
      }, this.timer);
    }
  }

  getQuantity(price: BigNumber, side: number): BigNumber {
    if (side == 0){
        if (this.contracts[this.quote].portfolioAvail / price.toNumber() > this.flatAmount){
            return new BigNumber(this.flatAmount);
        } else {
            return new BigNumber(this.contracts[this.quote].portfolioAvail / price.toNumber());
        }
    } else {
        if (this.contracts[this.base].portfolioAvail > this.flatAmount){
            return new BigNumber(this.flatAmount);
        } else {
            return new BigNumber(this.contracts[this.base].portfolioAvail);
        }
    }
  }

  // Update the marketPrice from an outside source
  async getNewMarketPrice() {
    try {
      let response = await axios.get('http://localhost:3000/prices');
      let prices = response.data;
      
      this.baseUsd = prices[this.base+'-USD']; 
      this.quoteUsd = prices[this.quote+'-USD']; 

      if (this.base == "sAVAX"){
        let totalPooledAvax = await this.savaxContract.totalPooledAvax();
        let totalSupply = await this.savaxContract.totalSupply();
        totalPooledAvax = new BigNumber(totalPooledAvax.toString());
        totalSupply = new BigNumber(totalSupply.toString());

        this.baseUsd = totalPooledAvax.shiftedBy(-18).div(totalSupply.shiftedBy(-18)).toNumber() * this.quoteUsd * .9992;
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

}

export default MarketMakerBot;
