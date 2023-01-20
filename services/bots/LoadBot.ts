
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

    //await this.cancelAll();

    // this will refill the gas tank if running low
    try {
      let i=0
      for (const order of this.orders.values()) {
        await this.cancelOrder(order);
        i++;
        if (i>=2){ //only cancel 2 orders
          break;
        }
      }

    await this.addLimitOrderList();

    this.logger.debug (`${JSON.stringify(this.getOrderBook())}`);

  } catch (error){
    this.logger.error (`${this.instanceName} Error in UpdateOrders`, error);
    //process.exit(1);
  } finally {
    // Sleep 5 seconds
    await utils.sleep(5000);
    //  Enable the next line if you need the bot to run continuously
    this.startOrderUpdater();
  }
}


  async addLimitOrderList () {

    const clientOrderIds=[];
    const prices=[];
    const quantities= [];
    const sides =[];
    const type2s =[];
    const marketpx = await this.getNewMarketPrice();

    //buy orders
    for (let i=0; i<6; i++) {

      const clientOrderId = await this.getClientOrderId(i)
      const pxdivisor = this.base ==='tALOT' ? 200 : 20;
      const px = i%2==0 ? marketpx.minus(i/pxdivisor)  : marketpx.plus(i/pxdivisor);
      const side = i%2;
      const type = 1;
      const type2 =0;
      const quantity = this.base ==='tALOT' ? utils.randomFromIntervalPositive(40, 350, this.baseDisplayDecimals)
              : utils.randomFromIntervalPositive(0.5, 100, this.baseDisplayDecimals);
      const priceToSend = utils.parseUnits(px.toFixed(this.quoteDisplayDecimals), this.contracts[this.quote].tokenDetails.evmdecimals);
      const quantityToSend = utils.parseUnits(quantity.toFixed(this.baseDisplayDecimals), this.contracts[this.base].tokenDetails.evmdecimals);
      clientOrderIds.push(clientOrderId);


      prices.push(priceToSend);
      quantities.push(quantityToSend);
      sides.push(side);
      type2s.push(type2);

      const order = this.makeOrder(this.account,
        this.tradePairByte32,
        '', // orderid not assigned by the smart contract yet
        clientOrderId,
        priceToSend,
        0,
        quantityToSend,
        side, // 0-Buy
        type, type2, // Limit, GTC
        9, //PENDING status
        0, 0, '', 0, 0, 0, 0 );

      this.addOrderToMap(order);

    }

    try {

    const tx = await this.tradePair.addLimitOrderList( this.tradePairByte32,clientOrderIds,prices, quantities, sides,
                     type2s, true,  await this.getOptions(this.contracts["SubNetProvider"]) );
    const orderLog = await tx.wait();

     //Add the order to the map quickly to be replaced by the event fired by the blockchain that will follow.
    if (orderLog){
        for (const _log of orderLog.events) {
          if (_log.event) {
            if (_log.event === 'OrderStatusChanged') {
              if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                await this.processOrders(_log.args.version, this.account, _log.args.pair, _log.args.orderId,  _log.args.clientOrderId, _log.args.price, _log.args.totalamount
                  , _log.args.quantity, _log.args.side, _log.args.type1, _log.args.type2, _log.args.status, _log.args.quantityfilled, _log.args.totalfee , _log) ;
              }
            }
          }
        }
      }
    } catch (error:any) {
          for (const clientOrderId of clientOrderIds) {
          //Need to remove the pending order from the memory if there is any error
            this.removeOrderByClOrdId(clientOrderId);
          }

          const nonceErr = 'Nonce too high';
          const idx = error.message.indexOf(nonceErr);
          if (error.code === "NONCE_EXPIRED" || idx > -1 ) {
            this.logger.warn (`${this.instanceName} addLimitOrderList error: Invalid Nonce `);

            await this.correctNonce(this.contracts["SubNetProvider"]);
          } else {
            const reason = await this.getRevertReason(error);
            if (reason) {
              this.logger.warn (`${this.instanceName} addLimitOrderList error: Revert Reason ${reason}`);

            } else {
              this.logger.error (`${this.instanceName} addLimitOrderList error:`, error);
            }
          }

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
        const pxDivizor = this.base ==='tALOT' ? 100 : 1;
        const px = utils.randomFromIntervalPositive(16/pxDivizor, 16.3/pxDivizor, this.quoteDisplayDecimals)
        this.setMarketPrice(px);
        // this.baseUsd = PriceService.prices[this.priceSymbolPair.base];
        // this.quoteUsd = PriceService.prices[this.priceSymbolPair.quote];

        this.baseUsd = px;  //AVAX
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
