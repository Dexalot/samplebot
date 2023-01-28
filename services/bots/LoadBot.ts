
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import { getConfig } from "../../config";
import { Performance } from "perf_hooks";

const apiUrl =  getConfig('API_URL') + "trading/";
class LoadBot extends AbstractBot{

  protected marketPrice =new BigNumber(17); //AVAX/USDC
  protected baseUsd= 17;  //AVAX
  protected quoteUsd= 1; //USDC
  protected capitalASideUSD=300;

  constructor(botId:number, pairStr: string, privateKey: string, ratelimit_token?: string) {
    super(botId, pairStr, privateKey, ratelimit_token);
    // Do not rebalance the portfolio. The tokens are expected to be in the subnet already
    this.portfolioRebalanceAtStart= "N";
    this.washTradeCheck=false;

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

      //await this.addSingleOrders(1, 1, 10, 13); // Sell 1500 at 13
      //await this.addLimitOrderList(100, 0); // 100 random BUY orders

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

async generateOrders (nbrofOrdersToAdd:number, addToMap = true, side = 99, quantity=0, price =0) {
    const clientOrderIds=[];
    const prices=[];
    const quantities= [];
    const sides =[];
    const type2s =[];
    const marketpx = await this.getNewMarketPrice();
    const blocknumber =
        (await this.contracts["SubNetProvider"].provider.getBlockNumber()) || 0;

    //buy orders
    for (let i=0; i<nbrofOrdersToAdd; i++) {

      const clientOrderId = await this.getClientOrderId(blocknumber, i)
      const pxdivisor = this.base ==='tALOT' ? 2000 : 20;
      let px = marketpx;

      if (price > 0) {
        px = BigNumber(price);
      }

      if (quantity === 0) { // quantity not given
          switch (this.base) {
            case 'tALOT' : {
              quantity =  utils.randomFromIntervalPositive(5, 50, this.baseDisplayDecimals);
              break;
            }
            case 'tAVAX' : {
              quantity =  utils.randomFromIntervalPositive(0.05, 0.5, this.baseDisplayDecimals);
              break;
            }
            case 'WETH.e' : {
              quantity =  utils.randomFromIntervalPositive(0.03, 0.05, this.baseDisplayDecimals);
              break;
            }
          }
      }

      if (side >  1 ) { // if side is not given
        px = i%2==0 ? marketpx.minus(i/pxdivisor)  : marketpx.plus(i/pxdivisor);
        side = i%2;
      }

      const type = 1;
      const type2 = 0;
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


  async addSingleOrders (nbrofOrdersToAdd:number, side = 99, quantity=0, price =0) {

    const orders = await this.generateOrders(nbrofOrdersToAdd, false, side, quantity, price);

    for (let i=0; i< orders.clientOrderIds.length; i++) {
      await this.addOrder (orders.sides[i]
      , BigNumber(utils.formatUnits(orders.quantities[i], this.contracts[this.base].tokenDetails.evmdecimals))
      , BigNumber(utils.formatUnits(orders.prices[i], this.contracts[this.quote].tokenDetails.evmdecimals))
      , 1, orders.type2s[i])
    }
  }

  async addLimitOrderList (nbrofOrdersToAdd = 10, side = 99, quantity=0, price =0) {
    const startTime = performance.now();
    const orders = await this.generateOrders(nbrofOrdersToAdd, true, side, quantity, price );
    const endTime2 = performance.now();

    console.log(`Generate Orders took ${(endTime2 - startTime)/1000} seconds`)
    try {

    const gasest= await this.getAddOrderListGasEstimate(orders.clientOrderIds, orders.prices, orders.quantities, orders.sides,
      orders.type2s, false);

    this.logger.warn (`${this.instanceName} Gas Est ${gasest.toString()}`);

    const tx = await this.tradePair.addLimitOrderList( this.tradePairByte32, orders.clientOrderIds,orders.prices, orders.quantities, orders.sides,
        orders.type2s, false,  await this.getOptions(this.contracts["SubNetProvider"], gasest) );
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

        } finally {
          const endTime = performance.now();
          console.log(`Send List Orders took ${(endTime - endTime2)/1000} seconds`)
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

        let px ;

        switch (this.base) {
          case 'tALOT' : {
            px =  utils.randomFromIntervalPositive(0.16, 0.162, this.quoteDisplayDecimals);
            break;
          }
          case 'tAVAX' : {
            px =  utils.randomFromIntervalPositive(16, 16.3, this.quoteDisplayDecimals);
            break;
          }
          case 'WETH.e' : {
            px =  utils.randomFromIntervalPositive(1600, 1620, this.quoteDisplayDecimals);
            break;
          }
          default : {
            px =  utils.randomFromIntervalPositive(16, 16.3, this.quoteDisplayDecimals);
          }
        }


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
