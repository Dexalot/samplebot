
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import axios from "axios";
import { getConfig } from "../../config";

const apiUrl =  getConfig('API_URL') + "trading/";
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

  async getEnvironments() {
    this.environments=  (await axios.get(apiUrl + 'environments/')).data;
    if (this.environments[1].chain_name === "Dexalot Subnet") {
      this.environments[1].chain_instance = "http://18.119.75.43:9650/ext/bc/21Ths5Afqi5r4PaoV8r8cruGZWhN11y5rxvy89K8px7pKy3P8E/rpc"
    }
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info (`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize (): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing){
      await this.getNewMarketPrice();

      this.interval =  5000 //Min 10 seconds

      this.minTradeAmnt = this.pairObject.mintrade_amnt * 1.1 ;
      this.maxTradeAmnt = this.pairObject.mintrade_amnt * 5;

      return true;
    } else {
      return false;
    }

  }


  async startOrderUpdater  ()  {
    if (this.status) {
      //Enable the next line if you need the bot to run continuously
      this.orderUptader = setTimeout( () => this.updateOrders(), this.interval );
    } else {
      this.logger.warn (`${this.instanceName} Bot Status set to false, will not send orders`);
    }
  }

  async updateOrders () {
    if (this.orderUptader != undefined){
      clearTimeout(this.orderUptader);
    }

    await this.cancelAll(14);
    // this will refill the gas tank if running low
    await this.cancelIndividualOrders(2);

    try {
      await this.addSingleOrders(2);
      await this.addLimitOrderList(14);

      this.logger.debug (`${JSON.stringify(this.getOrderBook())}`);

  } catch (error){
    this.logger.error (`${this.instanceName} Error in UpdateOrders`, error);
    //process.exit(1);
  } finally {
    //  Enable the next line if you need the bot to run continuously
    this.startOrderUpdater();
  }
}

async cancelIndividualOrders (nbrofOrderstoCancel:number) {
      let i=0
      for (const order of this.orders.values()) {
        await this.cancelOrder(order);
        i++;
        if (i>= nbrofOrderstoCancel){
          break;
        }
      }
}

async generateOrders (nbrofOrdersToAdd:number, addToMap = true) {
    const clientOrderIds=[];
    const prices=[];
    const quantities= [];
    const sides =[];
    const type2s =[];
    const marketpx = await this.getNewMarketPrice();

    //buy orders
    for (let i=0; i<nbrofOrdersToAdd; i++) {

      const clientOrderId = await this.getClientOrderId(i)
      const pxdivisor = this.base ==='tALOT' ? 2000 : 20;
      const px = i%2==0 ? marketpx.minus(i/pxdivisor)  : marketpx.plus(i/pxdivisor);
      const side = i%2;
      const type = 1;
      const type2 =0;
      const quantity = this.base ==='tALOT' ? utils.randomFromIntervalPositive(40, 300, this.baseDisplayDecimals)
              : utils.randomFromIntervalPositive(0.5, 10, this.baseDisplayDecimals);
      const priceToSend = utils.parseUnits(px.toFixed(this.quoteDisplayDecimals), this.contracts[this.quote].tokenDetails.evmdecimals);
      const quantityToSend = utils.parseUnits(quantity.toFixed(this.baseDisplayDecimals), this.contracts[this.base].tokenDetails.evmdecimals);


      clientOrderIds.push(clientOrderId);
      prices.push(priceToSend);
      quantities.push(quantityToSend);
      sides.push(side);
      type2s.push(type2);

      if (addToMap) {
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

    }

    return {clientOrderIds, prices, quantities, sides, type2s };
  }


  async addSingleOrders (nbrofOrdersToAdd:number) {

    const orders = await this.generateOrders(nbrofOrdersToAdd, false);

    for (let i=0; i< orders.clientOrderIds.length; i++) {
      await this.addOrder (orders.sides[i]
      , BigNumber(utils.formatUnits(orders.quantities[i], this.contracts[this.base].tokenDetails.evmdecimals))
      , BigNumber(utils.formatUnits(orders.prices[i], this.contracts[this.quote].tokenDetails.evmdecimals))
      , 1, orders.type2s[i])
    }
  }

  async addLimitOrderList (nbrofOrdersToAdd = 10) {

    const orders = await this.generateOrders(nbrofOrdersToAdd, true);

    try {

    const tx = await this.tradePair.addLimitOrderList( this.tradePairByte32, orders.clientOrderIds,orders.prices, orders.quantities, orders.sides,
      orders.type2s, true,  await this.getOptions(this.contracts["SubNetProvider"]) );
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
          for (const clientOrderId of orders.clientOrderIds) {
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
