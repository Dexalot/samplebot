import {ethers} from "ethers";
import {NonceManager} from "@ethersproject/experimental"
import Order from "../../models/order"
import { getConfig } from "../../config";
import utils from "../utils";
import {DeploymentType, DeploymentType as dt} from "../../models/deploymentType";
import { BigNumber } from "bignumber.js";
import { BigNumber as BigNumberEthers} from "ethers";
import axios from "axios";
import { getLogger } from "../logger";
import OrderBook from "./orderbook";

const ERC20ABI = require('../../artifacts/contracts/ERC20.json')
const apiUrl =  getConfig('API_URL') + "trading/";
const provider =  new ethers.providers.JsonRpcProvider(getConfig('CHAIN_INSTANCE'));
const ADDRESS0 ='0x0000000000000000000000000000000000000000000000000000000000000000';

abstract class AbstractBot {
  protected logger;
  protected instanceName:string
  protected status:boolean = false; // True if running , false if stopped
  protected botId:number
  protected tradePairIdentifier:string
  protected base:string
  protected quote:string
  protected provider:any
  protected wallet:any
  protected account:string
  protected orders:Map<any,any>
  protected initialized:boolean = false;

  protected balanceId: number | undefined
  protected orderCount:number =0;
  protected localnonce:number =0;
  protected config:any
  protected portfolio:any 
  protected pairObject: any | undefined;
  protected tradePairByte32: string | undefined;
  protected basecontract: any| undefined;
  protected quotecontract: any | undefined;

  protected basebalTotal: any;
  protected basebalAvail: any;
  protected quotebalTotal: any;
  protected quotebalAvail: any;
  protected basebal: any;
  protected quotebal: any;
  protected avaxChainbalance: any;
  protected baseChainBalance: any;
  protected quoteChainBalance: any;
  protected baseByte32="";
  protected quoteByte32="";
  protected baseDecimals= 0;
  protected quoteDecimals= 0;
  protected minTradeAmnt= 0;
  protected maxTradeAmnt= 0;
  protected quoteDisplayDecimals=0;
  protected baseDisplayDecimals=0;

  protected tradePair: any;
  protected filter: any;
  protected cleanupCalled: boolean = false;
  protected interval: number = 20000;
  protected orderbook:any
  protected orderUptader: NodeJS.Timeout | undefined;
  protected rebalancePct= 0.9;
  protected portfolioRebalanceAtStart= "N";

  protected PNL:any; // Needs to be implemented

  constructor(botId:number, pairStr: string, privateKey: string) {
      this.logger = getLogger("Bot");
      this.instanceName = botId + ":" +  pairStr;
      this.logger.info (`${this.instanceName} Base Class constructor`);
      this.botId= botId;
      this.tradePairIdentifier = pairStr;
      this.base = pairStr.substr(0,pairStr.indexOf('/'));
      this.quote = pairStr.substr(pairStr.indexOf('/') + 1 );
      let wal = new ethers.Wallet(privateKey, provider);
      this.wallet= new NonceManager(wal);
      this.account = wal.address;
      this.orders =  new Map();
      this.orderbook = new OrderBook();

      (axios.defaults.headers! as unknown as Record<string, any>).common['Origin'] = getConfig('DOMAIN_LINK');

  }

  async getPairs() {
    const pairs: [any] =  (await axios.get(apiUrl + 'pairs')).data
    return pairs.find((item => item.pair === this.tradePairIdentifier));
  }

  async getDeployment(dt: DeploymentType) {
    const deployment: any = (await axios.get(apiUrl + 'deploymentabi/'+ dt)).data
    this.logger.info(`${this.instanceName} ${dt} Contract at: ${deployment.address}`);
    return deployment;
  }

  async getBotConfig () {
    var configList: string | any[] =  []
    this.logger.info (`${this.instanceName} Fetched bot settings for bot id: ${this.botId} of length ${configList.length}`);
    return configList;
  }

  async initialize () : Promise<boolean> {
    if (!this.initialized) {
      this.config = (await this.getBotConfig());
      this.pairObject = await this.getPairs();     
      if(this.pairObject) {

        this.logger.info (`${this.instanceName} Base Class Initialize`);
        this.localnonce = await provider.getTransactionCount(this.account);
        this.tradePairByte32 = utils.fromUtf8(this.tradePairIdentifier);

        // get Exchange contract
        var deployment: any = await this.getDeployment(dt.Exchange);
        let exchange = new ethers.Contract(deployment.address, deployment.abi.abi, provider);

        // get Portfolio contract reference
        let portfolioAddr = await exchange.getPortfolio();
        deployment = await this.getDeployment(dt.Portfolio); 
        this.portfolio = new ethers.Contract(portfolioAddr, deployment.abi.abi, this.wallet);

        let tradePairAbi:any = await this.getDeployment(dt.TradePairs);

        this.baseByte32 = utils.fromUtf8(this.pairObject.base);
        this.quoteByte32 = utils.fromUtf8(this.pairObject.quote);
        this.baseDecimals = this.pairObject.base_evmdecimals;
        this.quoteDecimals = this.pairObject.quote_evmdecimals;

        this.minTradeAmnt = this.pairObject.mintrade_amnt;
        this.maxTradeAmnt = this.pairObject.mintrade_amnt; 
        this.quoteDisplayDecimals = this.pairObject.quotedisplaydecimals;
        this.baseDisplayDecimals = this.pairObject.basedisplaydecimals;

        var tradePairsAddr = await exchange.getTradePairsAddr();
        this.tradePair = new ethers.Contract(tradePairsAddr, tradePairAbi.abi.abi, this.wallet);
        var tokenaddress;
        // Needed to get wallet balances
        if (!this.isNative(this.base)) {
          tokenaddress = await this.portfolio.getToken(this.baseByte32);
          this.basecontract = new ethers.Contract(tokenaddress, ERC20ABI.abi, this.wallet);
        }
        if (!this.isNative(this.quote)) {
          tokenaddress = await this.portfolio.getToken(this.quoteByte32);
          this.quotecontract = new ethers.Contract(tokenaddress, ERC20ABI.abi, this.wallet);
        }

        //TO LOG START BALANCES AND MAKE THEM $ NEUTRAL
        await this.getBalances();
        //RECOVER FROM DB for OPEN ORDERS
        await this.processOpenOrders();

        // exit handler to remove all open buy and sell orders from all simulators
          process.on('SIGINT', async()=> { // Needed for Local Windows Ctrl-C
            await this.cleanUpAndExit();
            });

          process.on('exit', async() => { 
            await this.cleanUpAndExit();
          });

          process.on('SIGTERM', async() => { //Needed for AWS
            await this.cleanUpAndExit();
          });
          
          process.on('uncaughtException', (error)  => {
              this.logger.error(`${this.instanceName} uncaughtException happened:`,  error);
          });

          process.on('unhandledRejection', (error, promise) => {
              this.logger.error(`${this.instanceName} We forgot to handle a promise rejection here:`, promise);
              this.logger.error(`${this.instanceName} The error was:`, error );
          });

          this.initialized = true;
          return true; // means initialization in progress

      } else {
        this.logger.error (`${this.instanceName} Will not Initialize, because Bot ${this.tradePairIdentifier} not found`);
        return false;
      }
    } else {
        this.localnonce = await provider.getTransactionCount(this.account);
        return false;
    }
  }


  async start () {
    if (this.initialized && !this.status) {
      this.status=true;
      this.balanceId = undefined;
      let balancesRefreshed = await this.doInitialFunding();
      this.saveBalancestoDb(balancesRefreshed);
      provider.on("pending", (tx:any) => {
        this.processPending.bind(tx, this);
        // Emitted when any new pending transaction is noticed
      });

      if (!this.filter) {
        this.logger.info (`${this.instanceName} Starting Order Listener`);
        this.filter =  this.tradePair.filters.OrderStatusChanged(this.account); //, this.tradePairByte32 not filtering by symbol on purpose
        this.tradePair.on(this.filter, this.processOrders.bind(this));
      } else {
        this.logger.info (`${this.instanceName} Reusing the active order listener that was found...`);
      }
      this.startOrderUpdater();
    } else {
      this.logger.warn (`${this.instanceName} Cannot start because Bot is not initialized`);

    }
  }

  async stop () {
    let savetoDb =this.status;
    this.logger.warn (`${this.instanceName} Stoppig bot...`);
    this.status=false;  
    if (this.orderUptader !== undefined) {
      clearTimeout(this.orderUptader);
    }
    if (await this.getSettingValue('CANCEL_ALL_AT_STOP')==='Y') {
      this.cancelAll().then(() => {
        this.logger.warn (`${this.instanceName} Waiting 5 seconds before removing order listeners"...`);
          setTimeout(async () => {   
            if (savetoDb) {
              await this.saveBalancestoDb(false); 
            }
            if (this.PNL) {this.PNL.reset()};
            if (this.filter) { //Give 5 seconds before removing listeners
              this.tradePair.removeAllListeners();
              this.filter = undefined ;
              this.logger.warn (`${this.instanceName} Removed order listeners`);
            }
      }, 5000);
      });
    } else {
        this.logger.warn (`${this.instanceName} Waiting 5 seconds before removing order listeners"...`);
        setTimeout(async () => {   
            if (savetoDb) {
              await this.saveBalancestoDb(false); 
            }
            if (this.PNL) {this.PNL.reset()};
            if (this.filter) { //Give 5 seconds before removing listeners
              this.tradePair.removeAllListeners();
              this.filter = undefined ;
              this.logger.warn (`${this.instanceName} Removed order listeners`);
            }
      }, 5000);
    }
  }

  getSettingValue = async (settingname:string) => {
    var settingIdx = this.config.findIndex((item: { setting_name: string; }) => item.setting_name === settingname);
    var settingVal;

    if (settingIdx > -1 ) {
      if ( this.config[settingIdx].setting_data_type ==='NUMBER') {
        settingVal = Number(this.config[settingIdx].setting_value);
      } else {
        settingVal = this.config[settingIdx].setting_value;
      }
    } else {
      this.logger.warn (`${this.instanceName} Setting ${settingname} not found`);
    }
    return settingVal;
  }

  abstract saveBalancestoDb (balancesRefreshed:boolean): Promise<void>;
  abstract getPrice (side:number) : Promise<BigNumber>; 
  abstract getAvaxPrice () : Promise<number>; 
  // infinite loop that updates the order books periodically
  abstract startOrderUpdater (): Promise<void> ;
  abstract getBaseCapital() :number;
  abstract getQuoteCapital() :number;
  abstract getNewMarketPrice() : Promise<BigNumber> ;


  async getOrderBook() {
    let orderbook=  this.orderbook.state();
    return {instanceName: this.instanceName, Asks: orderbook.asks.map((p: {price: BigNumber; quantity: BigNumber}) => [p.price.toString(), p.quantity.toString()]) ,
      Bids: orderbook.bids.map((p: { price: BigNumber; quantity: BigNumber}) => [p.price.toString(), p.quantity.toString()])
    };
  }

  isInitialized () {
    return this.initialized;
  }

  async getQuantity(price:BigNumber, side:number) {
    return new BigNumber(this.minTradeAmnt * (1+ Math.random()* 0.2)).div(price);
  }

  async addOrder (side:number, qty:BigNumber| undefined, px:BigNumber| undefined, ordtype=1) { // LIMIT ORDER)
      if (!this.status) {
        return;
      }
      let price = px;
      let quantity = qty;

      try {
        let marketPrice = await this.getPrice(side); // Retuns adjustedBid or Ask
        if (!price) {
          if (ordtype === 1 || ordtype === 5) {
            price = marketPrice;
          } else {
            price = new BigNumber(0);
          }
        } else {
          if (ordtype === 0) {
            price = new BigNumber(0);
          }
        }

        if (!quantity) {
            quantity = await this.getQuantity(marketPrice, side) ;
        }

        if (( ((ordtype === 1 || ordtype === 5) && price.gt(0)) || ordtype===0 )  && quantity.gt(0)) {

          if (side === 0) {
            if (marketPrice.times(quantity).gt(this.quotebalAvail)) {
              this.logger.error (`${this.instanceName} Not enough funds to add BUY order`);
              utils.printBalances(this.account, this.quote, this.quotebal, this.quoteDecimals);
              return;
            }

            let bestask= this.orderbook.bestask();
            if (bestask && ordtype === 1){
              let order = this.orders.get(bestask.orders[0].id);
              if (order && price.gte(order.price)) {      
                this.logger.warn (`${this.instanceName} 'Wash trade not allowed. New BUY order price ${price.toFixed(this.quoteDisplayDecimals)} >=  ${order.price.toString()}`);
                return;
              }
            }

          } else {
            if (quantity.gt(this.basebalAvail)) {
              this.logger.error (`${this.instanceName} Not enough funds to add SELL order`);
              utils.printBalances(this.account, this.base, this.basebal, this.baseDecimals);
              return;
            }

            let bestbid= this.orderbook.bestbid();
            if (bestbid && ordtype === 1){
              let order = this.orders.get(bestbid.orders[0].id);
              if (order && price.lte(order.price)) {      
                this.logger.warn (`${this.instanceName} 'Wash trade not allowed. New SELL order price ${price.toFixed(this.quoteDisplayDecimals)} <=  ${order.price.toString()}`);
                return;
              }
            }
          }

          this.orderCount++;

          let gasest= await this.getAddOrderGasEstimate(price, quantity, side, ordtype);
          let tcost = await this.getTCost(gasest);
          this.logger.debug (`${this.instanceName} New order gasEstimate: ${gasest} , tcost  ${tcost.toString()} `);
          this.logger.debug (`${this.instanceName} SENDING ORDER OrderNbr: ${this.orderCount} ${side === 0 ? 'BUY' :'SELL'}::: ${quantity.toFixed(this.baseDisplayDecimals)} ${this.base} @ ${ordtype===0 ? 'MARKET' : price.toFixed(this.quoteDisplayDecimals)} ${this.quote}`);

          // this.logger.info (`${utils.parseUnits(price.toFixed(this.quoteDisplayDecimals), this.quoteDecimals)}`);
          // this.logger.info (`${utils.parseUnits(quantity.toFixed(this.baseDisplayDecimals), this.baseDecimals)}`);
          let options = await this.getOptions()
          const tx = await this.tradePair.addOrder(this.tradePairByte32, utils.parseUnits(price.toFixed(this.quoteDisplayDecimals), this.quoteDecimals),
                utils.parseUnits(quantity.toFixed(this.baseDisplayDecimals), this.baseDecimals), side, ordtype, options );

        const orderLog = await tx.wait();

        this.logger.debug (`${this.instanceName} ORDER SENT ${side === 0 ? 'BUY' :'SELL'} ::: ${quantity.toFixed(this.baseDisplayDecimals)} @ ${ordtype===0 ? 'MARKET' : price.toFixed(this.quoteDisplayDecimals)} ${this.quote}`);
        //Add the order to the map quickly to be replaced by the event fired by the blockchain that will follow.
        if (orderLog){
            for (let _log of orderLog.events) {
              if (_log.event) {
                if (_log.event === 'OrderStatusChanged') {
                  if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                    this.processOrders(this.account, _log.args.pair, _log.args.id, _log.args.price, _log.args.totalamount, _log.args.quantity,
                        _log.args.side, _log.args.type1, _log.args.status, _log.args.quantityfilled, _log.args.totalfee , _log) ;
                  }
                }
              }
            }
          }
        }
      } catch (error:any) {
        var nonceErr = 'Nonce too high';
        var idx = error.message.indexOf(nonceErr);
        if (error.code === "NONCE_EXPIRED" || idx > -1 ) {
          this.logger.warn (`${this.instanceName} addOrder error: ${side === 0 ? 'BUY' :'SELL'}  ${quantity? quantity.toString(): 'undefined'} @ ${price? price.toString() : 'undefined'} Invalid Nonce `);

          await this.correctNonce();
        } else {
          var reason = await this.getRevertReason(error);
          if (reason) {
            this.logger.warn (`${this.instanceName} addOrder error: ${side === 0 ? 'BUY' :'SELL'}  ${quantity? quantity.toString(): 'undefined'} @ ${price? price.toString() : 'undefined'} Revert Reason ${reason}`);

          } else {
            this.logger.error (`${this.instanceName} addOrder error: ${side === 0 ? 'BUY' :'SELL'}  ${quantity? quantity.toString(): 'undefined'} @ ${price? price.toString() : 'undefined'}`, error);
          }
        }
      }
  }

  async getRevertReason(error: any) {
    let reason;
    var idx = error.message.indexOf("VM Exception while processing transaction: revert ");
    if (idx > -1 ) { //Hardhat revert reason already in the message
      return error.message.substring(idx + 50, idx + 59);
    } else {
      if (!error.transaction) { 
        this.logger.warn (`${this.instanceName} getRevertReason: error.transaction is undefined`);
      } else {
        //https://gist.github.com/gluk64/fdea559472d957f1138ed93bcbc6f78a
        let code = await provider.call(error.transaction, error.blockNumber);
        reason = ethers.utils.toUtf8String('0x' + code.substr(138));
        var i = reason.indexOf('\0'); // delete all null characters after the string
        if (i>-1) {
          return reason.substring(0, i);
        }
      }
    }
    return reason;
  }

  async getOptions (highGasLimit = false) {
    let gasPx= (await this.getGasPrice()) ;
    let gasP = Math.ceil(gasPx.mul(105).div(100).toNumber());
    //, chainId: getConfig('CHAIN_ID')
    let optionsWithNonce = {gasLimit: 4000000, maxFeePerGas:gasP , nonce:0};
    if (highGasLimit) {
      optionsWithNonce.gasLimit= 6000000;
    }
    optionsWithNonce.nonce = this.localnonce++;
    return optionsWithNonce;
  }

  isNative (symbol:string) {
    return symbol === 'AVAX'
  }

  async getTCost(gasEstimate:BigNumberEthers) {
    let gasPrice = await this.getGasPrice();
    let px = await this.getAvaxPrice();
    return utils.formatUnitsToNumber(gasPrice.mul(gasEstimate), 18) * px;
  }

  async getAddOrderGasEstimate(price:BigNumber ,quantity:BigNumber,side:number,ordtype:number) {
      return this.tradePair.estimateGas.addOrder(
        this.tradePairByte32,
        utils.parseUnits(price.toFixed(this.quoteDisplayDecimals), this.quoteDecimals),
        utils.parseUnits(quantity.toFixed(this.baseDisplayDecimals), this.baseDecimals),
        side,
        ordtype
    );
  }

  async getCancelOrderGasEstimate(order:any ) {
      return this.tradePair.estimateGas.cancelOrder(
        this.tradePairByte32,
        order.id
    );
  }

  async getGasPriceInGwei() {
    let gasPx = await this.getGasPrice();
    return gasPx.div(1e9).toNumber() ;
  }
  
  async getGasPrice() {
    let gasPx;
    if (getConfig('NODE_ENV_SETTINGS')==='localdb-hh') {
      gasPx = BigNumberEthers.from(25000000000);
    } else {
      gasPx = await provider.getGasPrice();
    } 
    return gasPx;
  }

  async correctNonce() {
    try {
      var expectedNonce = await provider.getTransactionCount(this.account);
      this.localnonce = expectedNonce;
    } catch (error) {
      this.logger.error (`${this.instanceName} 'Error during nonce correction`, error);
    }
  }

  async getWalletBalance (base:boolean) {
    var balance;
      if (base) {
        if (this.isNative(this.base)) {
          balance = await provider.getBalance(this.account);
        } else {
          balance = await this.basecontract.balanceOf(this.account);
        }
      } else {
        if (this.isNative(this.quote)) {
          balance = await provider.getBalance(this.account);
        } else {
          balance = await this.quotecontract.balanceOf(this.account);
        }
      }
    return balance;
  }

  async getBalances() {

    try {
      //Chain Wallet Balances

      //Chain Avax wallet
      var bal = await provider.getBalance(this.account);
      this.avaxChainbalance = utils.formatUnits(bal, 18);
      //console.log('AVAX Wallet', this.avaxChainbalance);

      if (this.avaxChainbalance <= await this.getSettingValue('LOW_AVAX_CHAIN_BALANCE') ) {
        var text= "*****************" +  this.instanceName + " LOW AVAX Chain Balance for account :" + this.account ;
        text = text + utils.lineBreak + '*****************************************************************************************';
        text = text + utils.lineBreak + 'LOW AVAX Chain Balance, you will not be able pay for gas fees soon unless you replenish your account. Current Balance: ' + this.avaxChainbalance;
        text = text + utils.lineBreak + '*****************************************************************************************'+ utils.lineBreak;
        this.logger.warn (`${text}`);
      }

      //Chain Base wallet
      bal = await this.getWalletBalance(true);
      this.baseChainBalance = utils.formatUnits(bal, this.baseDecimals);
      //Chain Quote wallet
      bal = await this.getWalletBalance(false);
      this.quoteChainBalance = utils.formatUnits(bal, this.quoteDecimals);

      //Portfolio Balances
      this.basebal = await this.portfolio.getBalance(this.account, this.baseByte32); //baseBal
      this.basebalTotal = utils.formatUnits(this.basebal.total, this.baseDecimals);
      this.basebalAvail = utils.formatUnits(this.basebal.available, this.baseDecimals);

      this.quotebal = await this.portfolio.getBalance(this.account, this.quoteByte32); //quoteBal
      this.quotebalTotal = utils.formatUnits(this.quotebal.total, this.quoteDecimals);
      this.quotebalAvail = utils.formatUnits(this.quotebal.available, this.quoteDecimals);


    } catch (error) {
      this.logger.error (`${this.instanceName} Error during  getBalance`, error);
    }
  }


  async makeOrder (traderaddress:any, pair:any, id:any, price:any, totalamount:any, quantity:any, side:any, type1:any
    , status:any, quantityfilled:any, totalfee:any, tx:any, blocknbr:any, gasUsed:any, gasPrice:any, cumulativeGasUsed:any):Promise<any> {

    return new Order ({id: id
      , traderaddress: traderaddress
      , quantity:new BigNumber(utils.formatUnits(quantity.toString(), this.baseDecimals))
      , pair: utils.toUtf8(pair)
      , tx: tx
      , price: new BigNumber(utils.formatUnits(price.toString(), this.quoteDecimals))
      , side: parseInt(side)
      , type: parseInt(type1)
      , status: parseInt(status)
      , quantityfilled: new BigNumber(utils.formatUnits(quantityfilled.toString(), this.baseDecimals))
      , totalamount: new BigNumber(utils.formatUnits(totalamount.toString(), this.quoteDecimals))
      , totalfee: new BigNumber(parseInt(side) === 0 ? utils.formatUnits(totalfee.toString(), this.baseDecimals) : utils.formatUnits(totalfee.toString(), this.quoteDecimals))
      , blocknbr: blocknbr
      , gasUsed:  gasUsed
      , gasPrice: utils.formatUnits(gasPrice, 9)
      , cumulativeGasUsed: cumulativeGasUsed
      });
    }


  async processPending(tx:any, event:any) {
    this.logger.warn (`${this.instanceName} processPending  ${tx} event ${event}`);
  }


  async processOrders ( traderaddress:any, pair:any, id:any, price:any, totalamount:any, quantity:any, side:any, type1:any
    , status:any, quantityfilled:any, totalfee:any , event:any) {
    try {

      if (pair === this.tradePairByte32) {
        var tx = await event.getTransactionReceipt();

        var order = await this.makeOrder(traderaddress,
          pair,
          id,
          price,
          totalamount,
          quantity,
          side, type1, status,
          quantityfilled,
          totalfee,
          event.transactionHash,
          event.blockNumber,
          tx.gasUsed.toString(),
          tx.effectiveGasPrice? tx.effectiveGasPrice.toString(): '225',
          tx.cumulativeGasUsed.toString()
          );
                 
        if (utils.statusMap[order.status] === "NEW" || utils.statusMap[order.status] === "PARTIAL") {
          await this.addOrderToMap(order);
        } else if (utils.statusMap[order.status] === "FILLED" || utils.statusMap[order.status] === "CANCELED") {
          await this.removeOrderFromMap(order);
        }
      }
    } catch (error) {
      this.logger.error (`${this.instanceName} Error during  processOrders`, error);
    }
  }

  async addOrderToMap(order:any) {
    if (!order){
      return;
    }
    const existingOrder = this.orders.get(order.id);
    if (existingOrder) {
      if (order.status === existingOrder.status && order.quantityfilled.eq(existingOrder.quantityfilled)) {

        this.logger.debug (`${this.instanceName} Duplicate Order event: ${order.id} ${order.pair} ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);

        //The same Order event received from the txReceipt & from the listener. Ignore
      } else {
        if (order.quantityfilled.gte(existingOrder.quantityfilled)) { // Against a stale/delayed event that has quantityfilled <= existing quantityfilled
          this.orders.set(order.id, order);
          this.orderbook.change(order);
          if (this.PNL) {this.PNL.addOrder(order)}; 
          this.logger.debug (`${this.instanceName} Update Order event: ${order.id} ${order.pair} ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);
        }
      }
    } else {
      this.orders.set(order.id, order);
      this.orderbook.add(order);
      if (this.PNL) {this.PNL.addOrder(order)}; 
      this.logger.debug (`${this.instanceName} New Order event: ${order.id} ${order.pair} ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);
    }
  }

  async removeOrderFromMap (order:any){
    if (!order){
      return;
    }
    if (this.orders.has(order.id)) {
      this.orders.delete(order.id);
      this.orderbook.remove(order);
      if (this.PNL) {this.PNL.addOrder(order)}; 
      //const order =  this.orders.get(order.id);
      this.logger.debug (`${this.instanceName} removeOrderFromMap Filled/Canceled Order event: ${order.id} ${order.pair} ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);

    } else {
      this.logger.debug (`${this.instanceName} removeOrderFromMap Filled/Canceled Order event, Order Not Found: ${order.id} ${order.pair} ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);
    }
  }

  async cancelAll () {
    try {
      var orderIds = Array.from(this.orders.keys());
      if (orderIds.length > 0) {
        this.orderCount++;
        this.logger.warn (`${this.instanceName} Cancelling all outstanding orders, OrderNbr ${this.orderCount}`);
        const tx = await this.tradePair.cancelAllOrders(this.tradePairByte32, orderIds, await this.getOptions(true));
        //const tx = await this.race({ promise:oderCancel , count: this.orderCount} );
        //const orderLog = await tx.wait();
        //const orderLog =  await this.race({ promise: tx.wait(), count: this.orderCount} );
        const orderLog = await tx.wait();
        if (orderLog){
          for (let _log of orderLog.events) {
            if (_log.event) {
              if (_log.event === 'OrderStatusChanged') {
                if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                  this.processOrders(this.account, _log.args.pair, _log.args.id, _log.args.price, _log.args.totalamount, _log.args.quantity,
                      _log.args.side, _log.args.type1, _log.args.status, _log.args.quantityfilled, _log.args.totalfee , _log) ;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error (`${this.instanceName} Error during  CancelAll`, error);
    }
  }

  async cancelAllIndividually () {
    try {
        for (let order of this.orders.values()){
        await this.cancelOrder(order);
      }
    } catch (error) {
      this.logger.error (`${this.instanceName} Error during  cancelAllIndividually`, error);
    }
  }

  async cancelOrder  (order:any) {
      try {

          let gasest= await this.getCancelOrderGasEstimate(order);
          let tcost = await this.getTCost(gasest);
          this.logger.debug (`${this.instanceName} Cancel order gasEstimate: ${gasest}, tcost  ${tcost} `);

          this.orderCount++;
          this.logger.debug (`${this.instanceName} canceling OrderNbr: ${this.orderCount} ${order.side === 0 ? 'BUY' :'SELL'} ::: ${order.quantity.toString()} ${this.base} @ ${order.price.toString()} ${this.quote}`);
          let options = await this.getOptions(true) ;
          const tx = await this.tradePair.cancelOrder(this.tradePairByte32, order.id, options);
          //const tx = await this.race({ promise:oderCancel , count: this.orderCount} );
          //const orderLog = await this.race({ promise: tx.wait(), count: this.orderCount} );
          const orderLog = await tx.wait();

          if (orderLog){
            for (let _log of orderLog.events) {
              if (_log.event) {
                if (_log.event === 'OrderStatusChanged') {
                  if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                    this.processOrders(this.account, _log.args.pair, _log.args.id, _log.args.price, _log.args.totalamount, _log.args.quantity,
                        _log.args.side, _log.args.type1, _log.args.status, _log.args.quantityfilled, _log.args.totalfee , _log) ;
                  }
                }
              }
            }
          }
        return true;
      } catch (error:any) {

        var nonceErr = 'Nonce too high';
        var idx = error.message.indexOf(nonceErr);
        if (error.code === "NONCE_EXPIRED" || idx > -1 ) {
          this.logger.warn (`${this.instanceName} Order Cancel error ${order.side === 0 ? 'BUY' :'SELL'} ::: ${order.quantity.toFixed(this.baseDisplayDecimals)} @ ${order.price.toFixed(this.quoteDisplayDecimals)} Invalid Nonce`);
          await this.correctNonce();
        } else {
          var reason = await this.getRevertReason(error);
          if (reason) {
            if (reason==="T-OAEX-01"){
              await this.removeOrderFromMap(order);
            }
            this.logger.warn (`${this.instanceName} Order Cancel error ${order.side === 0 ? 'BUY' :'SELL'} ::: ${order.quantity.toFixed(this.baseDisplayDecimals)} @ ${order.price.toFixed(this.quoteDisplayDecimals)} Revert Reason ${reason}`);
           } else {
            this.logger.error (`${this.instanceName} Order Cancel error ${order.side === 0 ? 'BUY' :'SELL'} ::: ${order.quantity.toFixed(this.baseDisplayDecimals)} @ ${order.price.toFixed(this.quoteDisplayDecimals)}`,error);
           }
        }
        return false;
      }
  }


  //FIXME Gas usage is not returned from db. Enhance it to have it available for this as well.
  //Otherwise PNL will not reflect the Gas used for the recovered orders. (Possibly small impact)
  async getOpenOrders () {
    const orders: any= (await axios.get(getConfig('API_URL') + 'trading/openorders/params?traderaddress=' + this.account + '&pair=' + this.tradePairIdentifier)).data;
    return orders.rows ;
  }

  async processOpenOrders () {
    var orders = await this.getOpenOrders();
    for (const order of orders) {
      var ordert = new Order ({id: order.id
        , traderaddress: order.traderaddress
        , quantity:new BigNumber(order.quantity)
        , pair: order.pair
        , price: new BigNumber(order.price)
        , side: parseInt(order.side)
        , type: parseInt(order.type)
        , status: parseInt(order.status)
        , quantityfilled:new BigNumber(order.quantityfilled)
        , totalamount: new BigNumber(order.totalamount)
        , totalfee: new BigNumber(order.totalfee)
        , gasUsed:  0
        , gasPrice: 0
        , cumulativeGasUsed: 0
        });

      await this.addOrderToMap(ordert);
    }
    await this.checkOrdersInChain();
  }

  // Check the satus of the outstanding orders and remove if filled/canceled
  // If Live add the order to PNL
  async checkOrdersInChain (){
      for (let order of this.orders.values()) {
        const status = await this.checkOrderInChain(order.id);
        if (status) {
          this.logger.debug (`${this.instanceName} checkOrdersInChain: ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} ${this.base} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);
        }
    }
  }

  async checkOrderInChain (orderid:string) {
    try {

      const orderInChain =  await this.tradePair.getOrder(orderid);
      let order = await this.makeOrder (orderInChain.traderaddress, this.tradePairByte32, orderInChain.id, orderInChain.price,
         orderInChain.totalAmount, orderInChain.quantity, orderInChain.side, orderInChain.type1
        ,orderInChain.status, orderInChain.quantityFilled, orderInChain.totalFee, '','', '0', '0' ,'0') ; //tx, blocknbr , gasUsed, gasPrice, cumulativeGasUsed) ;

      const ordstatus = orderInChain.status;
      var orderinMemory = this.orders.get(orderid);

      if (orderInChain.id === ADDRESS0 // Order Not found- must have been removed.
            || utils.statusMap[ordstatus] === "FILLED" || utils.statusMap[ordstatus] === "CANCELED") {
        this.logger.warn (`${this.instanceName} checkOrderInChain: Order filled/cancelled Removing order  ${order.id} ${order.side === 0 ? 'BUY' :'SELL'} Status : ${orderInChain.id === ADDRESS0 ? 'NOTFOUND' :utils.statusMap[ordstatus]}`);
        await this.removeOrderFromMap(orderinMemory);
        return false;
      } else {
        if (orderinMemory && (orderinMemory.status != orderInChain.status ||  order.quantityfilled.gt(orderinMemory.quantityfilled)) ) {
          this.logger.warn (`${this.instanceName} checkOrderInChain: Intermediary message may have been missed ${order.id} ${order.side === 0 ? 'BUY' :'SELL'} Status on chain: ${utils.statusMap[order.status]} 
          Qty Filled on chain: ${order.quantity.toFixed(this.baseDisplayDecimals)} Qty Filled in mem:  ${orderinMemory.quantity.toFixed(this.baseDisplayDecimals)} ,Status in mem: ${utils.statusMap[orderinMemory.status]}`);
           await this.addOrderToMap(order);
        }
        return true;
      }
    } catch (error:any) {
      this.logger.error (`${this.instanceName} Error during checkOrderInChain ${orderid}`, error);
      return false;
    } 
  }

 
  async depositToken (contract:any, symbolByte32:string,  decimals:number, deposit_amount:any) {
    const tx1 = await contract.approve(this.portfolio.address, utils.parseUnits(deposit_amount.toString(), decimals), await this.getOptions());
    const log = await tx1.wait();
    if (this.PNL) {this.PNL.addDepositWithdrawGas(log)};
    const tx = await this.portfolio.depositToken(this.account, symbolByte32, utils.parseUnits(deposit_amount.toString(), decimals), await this.getOptions());
    const log2 =await tx.wait();
    if (this.PNL) {this.PNL.addDepositWithdrawGas(log2)};
 }

 async depositNative(deposit_amount:any, decimals:number) {
      const tx = await this.wallet.sendTransaction({to: this.portfolio.address, value: utils.parseUnits(deposit_amount.toString(), decimals), gasLimit: 3000000,
                                                    nonce : this.localnonce++ });
      const log = await tx.wait();
      if (this.PNL) {this.PNL.addDepositWithdrawGas(log)};
  }

  async withdrawNative (withdrawal_amount:any,  decimals:number) {
    const tx = await this.portfolio.withdrawNative(this.account, utils.parseUnits(withdrawal_amount.toString(), decimals), await this.getOptions());
    const log = await tx.wait();
    if (this.PNL) {this.PNL.addDepositWithdrawGas(log)};
  }

  async withdrawToken(withdrawal_amount:any, symbolByte32:string , decimals:number) {
    const tx = await this.portfolio.withdrawToken(this.account, symbolByte32, utils.parseUnits(withdrawal_amount.toString(), decimals), await this.getOptions());
    const log =await tx.wait();
    if (this.PNL) {this.PNL.addDepositWithdrawGas(log)};
  }


// Returns 0,0 if there is no order in the book for the empty array indexes. if 1 data point requested(best Bid, bestAsk) [0,0]
async getBookfromChain() {
  try {
    var borders = await this.tradePair.getNBuyBook(this.tradePairByte32,2)
    var sorders = await this.tradePair.getNSellBook(this.tradePairByte32,2)
    var buyOrderArray = [];
    var sellOrderArray = [];

    sellOrderArray.push(sorders[0].toString(),sorders[1].toString());
    buyOrderArray.push(borders[0].toString(),borders[1].toString());
    return {buyBook: buyOrderArray, sellBook: sellOrderArray};

  } catch (error){
    this.logger.error (`${this.instanceName} Error during getBookfromChain`, error);
  }
}

// returns true if any transfers happened from wallet to portfolio and need to refresh balances 
async doInitialFunding(): Promise<boolean>{
  // if any deposits/withdrawals are done,  balances are also refreshed
  const result = await this.fundPortfolioDollarNeutral();
  return result;
}

async fundPortfolioDollarNeutral (): Promise<boolean> {
  var deposit_amount:string;
  var amount =0;
  var withdraw_amount:string;

  await this.getNewMarketPrice();

  var baseCapital = this.getBaseCapital();
  var quoteCapital = this.getQuoteCapital();
  var refreshBalances =false;
  this.logger.info (`${this.instanceName} fundPortfolioDollarNeutral called! Calculated BaseCap ${baseCapital} ${this.base} Calculated QuoteCap ${quoteCapital} ${this.quote}`);
  try {
    if (this.portfolioRebalanceAtStart === "Y" ) {
      //BASE
      if (this.basebalTotal < baseCapital * (1- this.rebalancePct) || this.basebalTotal > baseCapital * (1+ this.rebalancePct)) {
        amount = baseCapital - parseFloat(this.basebalTotal); // - parseFloat(this.basebalAvail);
        deposit_amount = amount.toFixed(this.baseDisplayDecimals);
        if (amount > 0 ) {
          //Deposit
          if (this.baseChainBalance > amount) {
            if (this.isNative(this.base)) {
              await this.depositNative(deposit_amount, this.baseDecimals);
            } else {
              await this.depositToken(this.basecontract, this.baseByte32,this.baseDecimals,deposit_amount);
            }
            this.logger.info (`${this.instanceName} Approved: ${this.account} to deposit ${this.base} ${deposit_amount} to portfolio.`);
            refreshBalances = true;
          } else {
            this.logger.error (`${this.instanceName} Can not deposit additional funds to portfolio, not enough funds in Chain. Bal: ${this.base} ${this.baseChainBalance} Deposit Required: ${deposit_amount} `);
          }
        } else  {
          //withdrawal ..
          withdraw_amount = Math.abs(amount).toFixed(this.baseDisplayDecimals);
          if (this.basebalTotal > Math.abs(amount) ) {
            if (this.isNative(this.base)) {
              await this.withdrawNative(withdraw_amount, this.baseDecimals)
            } else {
              await this.withdrawToken(withdraw_amount, this.baseByte32, this.baseDecimals);
            }
            this.logger.info (`${this.instanceName} Approved: ${this.account} to withdraw ${this.base} ${withdraw_amount} from portfolio.`);
            refreshBalances = true;
          } else {
            this.logger.error (`${this.instanceName} Can not withdraw funds from portfolio, not enough funds in Portfolio. Bal: ${this.base} ${this.basebalTotal} Withdraw Required: ${withdraw_amount} `);
          }
        }
      } else {
        this.logger.info (`${this.instanceName} No Deposit/Withdraw needed for ${this.base}`);
      }

      //QUOTE
      if (this.quotebalTotal < quoteCapital * (1- this.rebalancePct) || this.quotebalTotal > quoteCapital * (1+ this.rebalancePct)) {
        amount = quoteCapital - parseFloat(this.quotebalTotal); // - parseFloat(this.quotebalAvail);
        deposit_amount = amount.toFixed(this.quoteDisplayDecimals);
        if (amount > 0 ) { //Deposit
          if (this.quoteChainBalance > amount) {
            if (this.isNative(this.quote)) {
              await this.depositNative(deposit_amount, this.quoteDecimals)
            } else {
              await this.depositToken(this.quotecontract,this.quoteByte32,this.quoteDecimals, deposit_amount);
            }
            this.logger.info (`${this.instanceName} Approved: ${this.account} to deposit ${this.quote} ${deposit_amount} to portfolio.`);
            refreshBalances = true;
          } else {
            this.logger.error (`${this.instanceName} Can not deposit additional funds to portfolio, not enough funds in Chain. Bal: ${this.quote} ${this.quoteChainBalance} Deposit Required: ${deposit_amount} `);
          }
        } else {
          //withdrawal ..
          withdraw_amount = Math.abs(amount).toFixed(this.quoteDisplayDecimals);
          if (this.quotebalTotal > Math.abs(amount)) {
            if (this.isNative(this.quote)) {
              await this.withdrawNative(withdraw_amount, this.quoteDecimals);
            } else {
              await this.withdrawToken(withdraw_amount, this.quoteByte32, this.quoteDecimals);
            }
            this.logger.info (`${this.instanceName} Approved: ${this.account} to withdraw ${this.quote} ${withdraw_amount} from portfolio.`);
            refreshBalances = true;
          } else {
            this.logger.error (`${this.instanceName} Can not withdraw funds from portfolio, not enough funds in Portfolio. Bal: ${this.quote} ${this.quotebalTotal} Withdraw Required: ${withdraw_amount}`);
           }
        }
      } else {
        this.logger.info (`${this.instanceName} No Deposit/Withdraw needed for ${this.quote}`);
      }
      if (refreshBalances){
        await this.getBalances();
        await this.correctNonce();
      }
      return refreshBalances;
    } else {
      return false;
    }
  } catch (error:any) {

    let nonceErr = 'Nonce too high';
    let idx = error.message.indexOf(nonceErr);
    if (error.code === "NONCE_EXPIRED" || idx > -1 ) {
      this.logger.warn (`${this.instanceName} Deposit/Withdrawal error: ${this.account} Invalid Nonce`);
      await this.correctNonce();
    } else {
      let reason = await this.getRevertReason(error);
      if (reason) {
        this.logger.warn (`${this.instanceName} Deposit/Withdrawal error: ${this.account} Revert Reason ${reason}`);
      } else {
        this.logger.error (`${this.instanceName} Deposit/Withdrawal error: ${this.account}`, error);
      }
    }
    return false;
  } 
 }

async cleanUpAndExit() {
    if (!this.cleanupCalled){
      this.logger.warn (`${this.instanceName} === Process Exit Called === `);
      this.cleanupCalled=true;
      this.stop();
      var timeout = Math.max(7, (await this.getSettingValue('CLEAR_TIMOUT_SECONDS')  || 10)) ; //Min 6 seconds because this.stop calls cancelall and waits for 5 seconds     
      setTimeout(() => {
        this.logger.warn (`${this.instanceName} === SHUTTING DOWN === `);
        process.exit(0) }, timeout * 1000
      );
    }
  }
}

export default AbstractBot;

