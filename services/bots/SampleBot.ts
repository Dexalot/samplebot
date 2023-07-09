import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";

class SampleBot extends AbstractBot {
  protected marketPrice = new BigNumber(17); //AVAX/USDC
  protected baseUsd = 17; //AVAX
  protected quoteUsd = 1; //USDC
  protected capitalASideUSD = 300;

  constructor(botId: number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
    // Will try to rebalance the amounts in the Portfolio Contract
    this.portfolioRebalanceAtStart = "N";
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
      await this.getNewMarketPrice();

      this.interval = 10000; //Min 10 seconds

      this.minTradeAmnt = this.pairObject.mintrade_amnt * 1.1;
      this.maxTradeAmnt = this.pairObject.mintrade_amnt * 5;

      // PNL  TO KEEP TRACK OF PNL , FEE & TCOST  etc
      //this.PNL = new PNL(getConfig('NODE_ENV_SETTINGS'), this.instanceName, this.base, this.quote, this.config, this.account);

      return true;
    } else {
      return false;
    }
  }

  async startOrderUpdater() {
    if (this.status) {
      // Enable the next line if you need the bot to run continuously
      // this.orderUptader = setTimeout( () => this.updateOrders(), this.interval );
      // Comment out if you need the bot to run continuously
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
      // Sleep 30 seconds initially for the original funding to reach the subnet. If it takes longer,
      // you'll get not enough funds error when sending orders. Ignore the errors and Just restart the bot.
      // after making sure that the funds reached the subnet
      // await utils.sleep(30000);

      //Bot automatically recovers any active orders from DB
      //This displays my local orderbook consisting of my own orders only. NOT from the exchange
      //Use this.getBookfromChain() for the Exchange orderbook
      this.logger.debug(`${JSON.stringify(this.getOrderBook())}`);
      //const bookinChain = await this.getBookfromChain();

      //Get rid of any order that is outstanding on this account if needed.
      //if you have more than 10-15 outstanding orders on this pair, this function may run out of gas
      // use this.cancelAllIndividually() instead.
      await this.cancelOrderList([], 100);

      // Sleep 30 seconds initially
      await utils.sleep(3000);

      const nbrofOrders = 4;
      const halfofOrders = nbrofOrders / 2;
      const quantity = new BigNumber(4);

      console.log(this.instanceName, "Sending Buy", nbrofOrders, "orders at different prices");
      let i;
      for (i = 0; i < halfofOrders; i++) {
        await this.addOrder(utils.sideMap.BUY, quantity, new BigNumber(i / 100 + 16));
      }
      console.log(this.instanceName, "Sending Sell", nbrofOrders, "orders at different prices");
      for (i = 0; i < halfofOrders; i++) {
        await this.addOrder(utils.sideMap.SELL, quantity, new BigNumber(i / 100 + 17));
      }
      console.log(this.instanceName, "Sleeping 10 seconds");
      this.logger.debug(`${JSON.stringify(this.getOrderBook())}`);
      await utils.sleep(10000);

      console.log(this.instanceName, "Cancelling all outstanding orders individually");
      await this.cancelAllIndividually();
      await utils.sleep(3000);
      this.logger.debug(`${JSON.stringify(this.getOrderBook())}`);

      console.log(this.instanceName, "Attempting to Sending and then fill from the same wallet address", nbrofOrders, "orders");
      for (i = 0; i < nbrofOrders; i++) {
        await this.addOrder(utils.sideMap.BUY, quantity, new BigNumber(i / 100 + 17));
      }

      //AbstractBot implementation will not allow wash trade. So the following orders won't be sent out.
      for (i = 0; i < nbrofOrders; i++) {
        await this.addOrder(utils.sideMap.SELL, quantity, new BigNumber(i / 100 + 17));
      }

      await utils.sleep(3000);
      this.logger.debug(`${JSON.stringify(this.getOrderBook())}`);

      //Market Orders need to be enabled for the pair. Otherwise these orders will revert..
      //See error.json in the root for the explanation of the revert reason codes.
      //The latest revert reasons are available at https://api.dexalot-test.com/api/trading/errorcodes
      for (i = 0; i < nbrofOrders; i++) {
        await this.addOrder(utils.sideMap.SELL, quantity, undefined, 0); // Send Market Orders
      }

      await utils.sleep(1000);
      this.logger.debug(`${JSON.stringify(this.getOrderBook())}`);
      process.exit(0);
    } catch (error) {
      this.logger.error(`${this.instanceName} Error in UpdateOrders`, error);
      process.exit(1);
    } finally {
      //  Enable the next line if you need the bot to run continuously
      // this.startOrderUpdater();
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
      // TODO Implement your own price source to get the Base & Quote price from an external source if necessary

      // this.setMarketPrice(PriceService.prices[this.priceSymbolPair.pair]);
      // this.baseUsd = PriceService.prices[this.priceSymbolPair.base];
      // this.quoteUsd = PriceService.prices[this.priceSymbolPair.quote];

      this.baseUsd = 17; //AVAX
      this.quoteUsd = 1; //USDC
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

export default SampleBot;
