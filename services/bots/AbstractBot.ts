import { ethers, utils as eutils } from "ethers";
import { NonceManager } from "@ethersproject/experimental";
import Order from "../../models/order";
import { getConfig } from "../../config";
import utils from "../utils";
import { BlockchainContractType } from "../../models/BlockchainContractType";
import { BigNumber } from "bignumber.js";
import { BigNumber as BigNumberEthers } from "ethers";
import axios from "axios";
import { getLogger } from "../logger";
import OrderBook from "./orderbook";
import NewOrder from "./classes";

import ERC20ABI from "../../artifacts/contracts/ERC20.json";
import OrderBookRecordRaw from "../../models/orderBookRecordRaw";
import OrderBookRaw from "../../models/orderBookRaw";
const apiUrl = getConfig("API_URL") + "privapi/trading/";
const signedApiUrl = getConfig("API_URL") + "privapi/signed/";
const ADDRESS0 = "0x0000000000000000000000000000000000000000000000000000000000000000";

abstract class AbstractBot {
  protected logger;
  protected instanceName: string;
  protected status = false; // True if running , false if stopped
  protected botId: number;
  protected tradePairIdentifier: string;
  protected base: string;
  protected quote: string;
  protected orders: Map<any, any>;
  protected initialized = false;

  protected account = "0x";
  protected balanceId: number | undefined;
  protected orderCount = 0;
  protected config: any;
  protected pairObject: any | undefined;
  protected tradePairByte32: string | undefined;

  protected minTradeAmnt = 0;
  protected maxTradeAmnt = 0;
  protected quoteDisplayDecimals = 0;
  protected baseDisplayDecimals = 0;

  protected tradePair: any;
  protected filter: any;
  protected cleanupCalled = false;
  protected interval = 20000;
  protected orderbook: any; //local orderbook to keep track of my own orders ONLY
  protected chainOrderbook: any; //orderbook from the chain
  protected orderUpdater: NodeJS.Timeout | undefined;
  protected rebalancePct = 0.9;
  protected portfolioRebalanceAtStart = false;
  protected lastExecution: any;
  protected PNL: any; // Needs to be implemented
  protected initialDepositBase = 10000;
  protected initialDepositQuote = 50000;
  protected environments: any;
  protected contracts: any = {};
  protected washTradeCheck = true;
  private privateKey: any;
  private ratelimit_token?: string;
  protected tokenDetails: any;
  protected signature: any;
  protected axiosConfig: any;

  protected bidSpread: any;
  protected askSpread: any;
  protected orderLevels: any;
  protected orderLevelSpread: any;
  protected orderLevelQty: any;

  constructor(botId: number, pairStr: string, privateKey: string, ratelimit_token?: string) {
    this.logger = getLogger("Bot");
    this.instanceName = botId + ":" + pairStr;
    this.logger.info(`${this.instanceName} Base Class constructor`);
    this.botId = botId;
    this.tradePairIdentifier = pairStr;
    this.base = pairStr.substring(0, pairStr.indexOf("/"));
    this.quote = pairStr.substring(pairStr.indexOf("/") + 1);
    this.privateKey = privateKey;
    this.orders = new Map();
    this.orderbook = new OrderBook();
    this.ratelimit_token = ratelimit_token;

    (axios.defaults.headers! as unknown as Record<string, any>).common["Origin"] = getConfig("ORIGIN_LINK");
    (axios.defaults.headers! as unknown as Record<string, any>).common["User-Agent"] =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36";
  }

  async getPairs() {
    const pairs: [any] = (await axios.get(apiUrl + "pairs")).data;
    return pairs.find((item) => item.pair === this.tradePairIdentifier);
  }

  async getDeployment(dt: BlockchainContractType) {
    const deployments: any = (await axios.get(apiUrl + "deployment?contracttype=" + dt + "&returnabi=true")).data;
    await this.loadDeployments(deployments);
  }

  async loadDeployments(deployments: any) {
    for (const c of deployments) {
      this.contracts[c.contract_name] = {
        contractName: c.contract_name,
        contract_type: c.contract_type,
        dbVersion: c.version,
        dbStatus: c.status,
        dbAction: c.action,
        address: c.address,
        implAddress: c.impl_address,
        abi: c.abi,
        deployedContract: null
      };
    }
  }

  async getDeployments() {
    await this.getDeployment(BlockchainContractType.Portfolio);
    await this.getDeployment(BlockchainContractType.TradePairs);
    this.contracts["AVAX"] = {
      contractName: "AVAX",
      inByte32: utils.fromUtf8("AVAX"),
      mainnetBal: 0,
      subnetBal: 0,
      portfolioTot: 0,
      portfolioAvail: 0,
      tokenDetails: null,
      deployedContract: null
    };
    this.contracts["ALOT"] = {
      contractName: "ALOT",
      inByte32: utils.fromUtf8("ALOT"),
      mainnetBal: 0,
      subnetBal: 0,
      portfolioTot: 0,
      portfolioAvail: 0,
      tokenDetails: null,
      deployedContract: null
    };
    this.contracts[this.base] = {
      contractName: this.base,
      inByte32: utils.fromUtf8(this.base),
      mainnetBal: 0,
      subnetBal: 0,
      portfolioTot: 0,
      portfolioAvail: 0,
      tokenDetails: null,
      deployedContract: null
    };
    this.contracts[this.quote] = {
      contractName: this.quote,
      inByte32: utils.fromUtf8(this.quote),
      mainnetBal: 0,
      subnetBal: 0,
      portfolioTot: 0,
      portfolioAvail: 0,
      tokenDetails: null,
      deployedContract: null
    };
  }

  async getBotConfig() {
    const configList: string | any[] = [];
    this.logger.info(`${this.instanceName} Fetched bot settings for bot id: ${this.botId} of length ${configList.length}`);
    return configList;
  }

  async getEnvironments() {
    this.environments = (await axios.get(apiUrl + "environments/")).data;
  }

  getEnvironment(envtype: string) {
    //mainnet, subnet
    return this.environments.find((item: any) => item.type === envtype);
  }

  async getTokenDetails() {
    this.tokenDetails = (await axios.get(apiUrl + "tokens/")).data;
  }

  async getTokenDetail(symbol: string): Promise<any> {
    return this.tokenDetails.find((item: any) => item.symbol === symbol);
  }

  async setNonce(provider: string): Promise<any> {
    this.contracts[provider].nonce = await this.contracts[provider].provider.getTransactionCount(this.account);
  }

  getProvider(url: string, ratelimit_token?: string) {
    if (ratelimit_token) {
      return new ethers.providers.StaticJsonRpcProvider({
        url: url,
        headers: { "x-rate-limit-token": ratelimit_token }
      });
    }
    return new ethers.providers.StaticJsonRpcProvider(url);
  }
  async initialize(): Promise<boolean> {
    if (!this.initialized) {
      this.config = await this.getBotConfig();
      this.pairObject = await this.getPairs();
      if (this.pairObject) {
        await this.getEnvironments();
        await this.getDeployments();
        await this.getTokenDetails();

        this.contracts["MainnetProvider"] = { provider: this.getProvider(this.getEnvironment("mainnet").chain_instance), nonce: 0 };
        this.contracts["SubNetProvider"] = {
          provider: this.getProvider(this.getEnvironment("subnet").chain_instance, this.ratelimit_token),
          nonce: 0
        };
        this.contracts["MainnetWallet"] = new NonceManager(new ethers.Wallet(this.privateKey, this.contracts["MainnetProvider"].provider));

        const wal = new ethers.Wallet(this.privateKey, this.contracts["SubNetProvider"].provider);
        this.contracts["SubnetWallet"] = new NonceManager(wal);
        this.account = wal.address;
        this.signature = await wal.signMessage("dexalot");
        this.axiosConfig = {
          headers: {
            "x-signature": `${this.account}:${this.signature}`
          }
        };
        this.logger.info(`${this.instanceName} Base Class Initialize`);
        this.setNonce("SubNetProvider");
        this.setNonce("MainnetProvider");

        this.tradePairByte32 = utils.fromUtf8(this.tradePairIdentifier);

        let deployment = this.contracts["PortfolioMain"];
        this.contracts["PortfolioMain"].deployedContract = new ethers.Contract(
          deployment.address,
          deployment.abi.abi,
          this.contracts["MainnetWallet"]
        );

        deployment = this.contracts["PortfolioSub"];
        this.contracts["PortfolioSub"].deployedContract = new ethers.Contract(
          deployment.address,
          deployment.abi.abi,
          this.contracts["SubnetWallet"]
        );

        deployment = this.contracts["TradePairs"];
        this.tradePair = new ethers.Contract(deployment.address, deployment.abi.abi, this.contracts["SubnetWallet"]);
        this.contracts["TradePairs"].deployedContract = this.tradePair;

        this.minTradeAmnt = this.pairObject.mintrade_amnt;
        this.maxTradeAmnt = this.pairObject.maxtrade_amnt;
        this.quoteDisplayDecimals = this.pairObject.quotedisplaydecimals;
        this.baseDisplayDecimals = this.pairObject.basedisplaydecimals;

        let avaxLoaded;

        this.contracts[this.base].tokenDetails = await this.getTokenDetail(this.base);
        // Needed to get wallet balances
        if (!this.isNative(this.base, "mainnet")) {
          this.contracts[this.base].deployedContract = new ethers.Contract(
            this.contracts[this.base].tokenDetails.address,
            ERC20ABI.abi,
            this.contracts["MainnetWallet"]
          );
        } else {
          avaxLoaded = true;
        }

        this.contracts[this.quote].tokenDetails = await this.getTokenDetail(this.quote);
        if (!this.isNative(this.quote, "mainnet")) {
          this.contracts[this.quote].deployedContract = new ethers.Contract(
            this.contracts[this.quote].tokenDetails.address,
            ERC20ABI.abi,
            this.contracts["MainnetWallet"]
          );
        } else {
          avaxLoaded = true;
        }

        if ("ALOT" !== this.base && "ALOT" !== this.quote) {
          this.contracts["ALOT"].tokenDetails = await this.getTokenDetail("ALOT");
          this.contracts["ALOT"].deployedContract = new ethers.Contract(
            this.contracts["ALOT"].tokenDetails.address,
            ERC20ABI.abi,
            this.contracts["MainnetWallet"]
          );
        }

        if (!avaxLoaded) {
          this.contracts["AVAX"].tokenDetails = await this.getTokenDetail("AVAX");
        }

        await this.getBalances();
        //TO LOG START BALANCES AND MAKE THEM $ NEUTRAL
        //RECOVER FROM DB for OPEN ORDERS
        await this.processOpenOrders();

        this.initialized = true;
        return true; // means initialization in progress
      } else {
        this.logger.error(`${this.instanceName} Will not Initialize, because Bot ${this.tradePairIdentifier} not found`);
        return false;
      }
    } else {
      this.setNonce("SubNetProvider");
      return false;
    }
  }

  async start() {
    if (this.initialized && !this.status) {
      this.status = true;
      this.balanceId = undefined;
      const balancesRefreshed = await this.doInitialFunding();
      this.saveBalancestoDb(balancesRefreshed);

      //FIXME this is not working
      this.contracts["SubNetProvider"].provider.on("pending", (tx: any) => {
        this.processPending.bind(tx, this);
        // Emitted when any new pending transaction is noticed
      });

      if (!this.filter) {
        this.logger.info(`${this.instanceName} Starting Order Listener`);
        this.filter = this.tradePair.filters.OrderStatusChanged(null, this.account); //, this.tradePairByte32 not filtering by symbol on purpose
        this.tradePair.on(this.filter, this.processOrders.bind(this));

        //FIXME Listen to Executed Event from
        //this.filter2 =  this.tradePair.filters.Executed(null, this.tradePairByte32);
      } else {
        this.logger.info(`${this.instanceName} Reusing the active order listener that was found...`);
      }
      this.startOrderUpdater();
    } else {
      this.logger.warn(`${this.instanceName} Cannot start because Bot is not initialized`);
    }
  }

  async stop() {
    const savetoDb = this.status;
    this.logger.warn(`${this.instanceName} Stoppig bot...`);
    this.status = false;
    if (this.orderUpdater !== undefined) {
      clearTimeout(this.orderUpdater);
    }
    if (this.getSettingValue("CANCEL_ALL_AT_STOP") === "Y") {
      this.cancelOrderList()
        .then(() => {
          this.logger.warn(`${this.instanceName} Waiting 5 seconds before removing order listeners"...`);
          setTimeout(async () => {
            if (savetoDb) {
              await this.saveBalancestoDb(false);
            }
            if (this.PNL) {
              this.PNL.reset();
            }
            if (this.filter) {
              //Give 5 seconds before removing listeners
              this.tradePair.removeAllListeners();
              this.filter = undefined;
              this.logger.warn(`${this.instanceName} Removed order listeners`);
            }
          }, 5000);
        })
        .catch((e: any) => {
          this.logger.error(`${this.instanceName} problem in Bot Stop + ${e.message}`);
        });
    } else {
      this.logger.warn(`${this.instanceName} Waiting 5 seconds before removing order listeners"...`);
      setTimeout(async () => {
        if (savetoDb) {
          await this.saveBalancestoDb(false);
        }
        if (this.PNL) {
          this.PNL.reset();
        }
        if (this.filter) {
          //Give 5 seconds before removing listeners
          this.tradePair.removeAllListeners();
          this.filter = undefined;
          this.logger.warn(`${this.instanceName} Removed order listeners`);
        }
      }, 5000);
    }
  }

  getSettingValue(settingname: string) {
    const settingIdx = this.config.findIndex((item: { setting_name: string }) => item.setting_name === settingname);
    let settingVal;

    if (settingIdx > -1) {
      if (this.config[settingIdx].setting_data_type === "NUMBER") {
        settingVal = Number(this.config[settingIdx].setting_value);
      } else {
        settingVal = this.config[settingIdx].setting_value;
      }
    } else {
      this.logger.warn(`${this.instanceName} Setting: ${settingname} not found`);
    }
    return settingVal;
  }

  abstract saveBalancestoDb(balancesRefreshed: boolean): Promise<void>;
  abstract getPrice(side: number): BigNumber;
  abstract getAlotPrice(): Promise<number>;
  // infinite loop that updates the order books periodically
  abstract startOrderUpdater(): Promise<void>;
  abstract getBaseCapital(): number;
  abstract getQuoteCapital(): number;
  abstract getNewMarketPrice(): Promise<BigNumber>;

  getOrderBook() {
    const orderbook = this.orderbook.state();
    return {
      instanceName: this.instanceName,
      Asks: orderbook.asks.map((p: { price: BigNumber; quantity: BigNumber }) => [p.price.toString(), p.quantity.toString()]),
      Bids: orderbook.bids.map((p: { price: BigNumber; quantity: BigNumber }) => [p.price.toString(), p.quantity.toString()])
    };
  }

  isInitialized() {
    return this.initialized;
  }

  getQuantity(price: BigNumber, side: number) {
    return new BigNumber(this.minTradeAmnt * (1 + Math.random() * 0.2)).div(price);
  }

  async addLimitOrderList(newOrders: NewOrder[]) {
    const clientOrderIds = [];
    const prices = [];
    const quantities = [];
    const sides = [];
    const type2s = [];

    const blocknumber = (await this.contracts["SubNetProvider"].provider.getBlockNumber()) || 0;

    for (let i = 0; i < newOrders.length; i++){
      const clientOrderId = await this.getClientOrderId(blocknumber, i);
      const priceToSend = utils.parseUnits(
        newOrders[i].price.toFixed(this.quoteDisplayDecimals),
        this.contracts[this.quote].tokenDetails.evmdecimals
      );
      const quantityToSend = utils.parseUnits(
        newOrders[i].quantity.toFixed(this.baseDisplayDecimals),
        this.contracts[this.base].tokenDetails.evmdecimals
      );
      clientOrderIds.push(clientOrderId);

      prices.push(priceToSend);
      quantities.push(quantityToSend);
      sides.push(newOrders[i].side);
      type2s.push(0);

      const order = this.makeOrder(
        this.account,
        this.tradePairByte32,
        "", // orderid not assigned by the smart contract yet
        clientOrderId,
        priceToSend,
        0,
        quantityToSend,
        0,
        1,
        0, //Buy , Limit, GTC
        9, //PENDING status
        0,
        0,
        "",
        0,
        0,
        0,
        0
      );

      this.addOrderToMap(order);
    }

    try {
      console.log("GETTING GAS ESTIMATION", prices, quantities, sides);
      
      const gasest = await this.getAddOrderListGasEstimate(clientOrderIds, prices, quantities, sides, type2s);

      console.log("SENDING ORDER LIST");

      this.logger.warn(`${this.instanceName} Gas Est ${gasest.toString()}`);
      const tx = await this.tradePair.addLimitOrderList(
        this.tradePairByte32,
        clientOrderIds,
        prices,
        quantities,
        sides,
        type2s,
        await this.getOptions(this.contracts["SubNetProvider"], gasest)
      );
      const orderLog = await tx.wait();

      //Add the order to the map quickly to be replaced by the event fired by the blockchain that will follow.
      if (orderLog) {
        for (const _log of orderLog.events) {
          if (_log.event) {
            if (_log.event === "OrderStatusChanged") {
              if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                await this.processOrders(
                  _log.args.version,
                  this.account,
                  _log.args.pair,
                  _log.args.orderId,
                  _log.args.clientOrderId,
                  _log.args.price,
                  _log.args.totalamount,
                  _log.args.quantity,
                  _log.args.side,
                  _log.args.type1,
                  _log.args.type2,
                  _log.args.status,
                  _log.args.quantityfilled,
                  _log.args.totalfee,
                  _log.args.code,
                  _log
                );
              }
            }
          }
        }
      }
    } catch (error: any) {
      for (const clientOrderId of clientOrderIds) {
        //Need to remove the pending order from the memory if there is any error
        this.removeOrderByClOrdId(clientOrderId);
      }

      const nonceErr = "Nonce too high";
      const idx = error.message.indexOf(nonceErr);
      if (error.code === "NONCE_EXPIRED" || idx > -1) {
        this.logger.warn(`${this.instanceName} addLimitOrderList error: Invalid Nonce `);

        await this.correctNonce(this.contracts["SubNetProvider"]);
      } else {
        const reason = await this.getRevertReason(error);
        if (reason) {
          this.logger.warn(`${this.instanceName} addLimitOrderList error: Revert Reason ${reason}`);
        } else {
          this.logger.error(`${this.instanceName} addLimitOrderList error:`, error);
        }
      }
    }
  }

  fundsAvailable(side: number, quantity: BigNumber, px: BigNumber) {
    if (side === 0) {
      return px.times(quantity).lte(this.contracts[this.quote].portfolioAvail);
    } else {
      return quantity.lte(this.contracts[this.base].portfolioAvail);
    }
  }

  async addOrder(side: number, qty: BigNumber | undefined, px: BigNumber | undefined, ordtype = 1, ordType2 = 0) {
    // LIMIT ORDER  & GTC)
    if (!this.status) {
      return;
    }

    const clientOrderId = await this.getClientOrderId();

    let price = px;
    let quantity = qty;
    try {
      const marketPrice = this.getPrice(side); // Returns adjustedBid or Ask
      if (!price) {
        if (ordtype === 1) {
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
        quantity = this.getQuantity(marketPrice, side);
      }

      if (((ordtype === 1 && price.gt(0)) || ordtype === 0) && quantity.gt(0)) {
        const funds = this.fundsAvailable(side, quantity, marketPrice);
        if (side === 0) {
          if (!funds) {
            this.logger.error(`${this.instanceName} Not enough funds to add BUY order`);
            utils.printBalances(this.account, this.quote, this.contracts[this.quote]);
            return;
          }
          this.checkWashTrade(side, price);
        } else {
          if (!funds) {
            this.logger.error(`${this.instanceName} Not enough funds to add SELL order`);
            utils.printBalances(this.account, this.base, this.contracts[this.base]);
            return;
          }
          this.checkWashTrade(side, price);
        }

        this.orderCount++;

        const gasest = await this.getAddOrderGasEstimate(clientOrderId, price, quantity, side, ordtype, ordType2);
        // const tcost = await this.getTCost(gasest);
        // this.logger.debug (`${this.instanceName} New order gasEstimate: ${gasest} , tcost  ${tcost.toString()} `);
        this.logger.debug(
          `${this.instanceName} SENDING ORDER OrderNbr: ${this.orderCount} ${side === 0 ? "BUY" : "SELL"}::: ${quantity.toFixed(
            this.baseDisplayDecimals
          )} ${this.base} @ ${ordtype === 0 ? "MARKET" : price.toFixed(this.quoteDisplayDecimals)} ${this.quote}`
        );
        // this.logger.info (`${utils.parseUnits(price.toFixed(this.quoteDisplayDecimals), this.contracts[this.quote].tokenDetails.evmdecimals)}`);
        // this.logger.info (`${utils.parseUnits(quantity.toFixed(this.baseDisplayDecimals), this.contracts[this.base].tokenDetails.evmdecimals)}`);

        const options = await this.getOptions(this.contracts["SubNetProvider"], gasest);

        const priceToSend = utils.parseUnits(price.toFixed(this.quoteDisplayDecimals), this.contracts[this.quote].tokenDetails.evmdecimals);
        const quantityToSend = utils.parseUnits(
          quantity.toFixed(this.baseDisplayDecimals),
          this.contracts[this.base].tokenDetails.evmdecimals
        );
        const order = this.makeOrder(
          this.account,
          this.tradePairByte32,
          "", // orderid not assigned by the smart contract yet
          clientOrderId,
          priceToSend,
          0,
          quantityToSend,
          side,
          ordtype,
          ordType2,
          9, //PENDING status
          0,
          0,
          "",
          0,
          0,
          0,
          0
        );

        this.addOrderToMap(order);

        const tx = await this.tradePair.addOrder(
          order.traderaddress,
          order.clientOrderId,
          this.tradePairByte32,
          priceToSend,
          quantityToSend,
          order.side,
          order.type,
          order.type2,
          options
        );

        const orderLog = await tx.wait();

        this.logger.debug(
          `${this.instanceName} ORDER SENT ${side === 0 ? "BUY" : "SELL"} ::: ${quantity.toFixed(this.baseDisplayDecimals)} @ ${
            ordtype === 0 ? "MARKET" : price.toFixed(this.quoteDisplayDecimals)
          } ${this.quote}`
        );
        //Add the order to the map quickly to be replaced by the event fired by the blockchain that will follow.
        if (orderLog) {
          for (const _log of orderLog.events) {
            if (_log.event) {
              if (_log.event === "OrderStatusChanged") {
                if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                  await this.processOrders(
                    _log.args.version,
                    this.account,
                    _log.args.pair,
                    _log.args.orderId,
                    _log.args.clientOrderId,
                    _log.args.price,
                    _log.args.totalamount,
                    _log.args.quantity,
                    _log.args.side,
                    _log.args.type1,
                    _log.args.type2,
                    _log.args.status,
                    _log.args.quantityfilled,
                    _log.args.totalfee,
                    _log.args.code,
                    _log
                  );
                }
              }
            }
          }
        }
      }
    } catch (error: any) {
      //Need to remove the pending order from the memory if there is any error
      this.removeOrderByClOrdId(clientOrderId);

      const nonceErr = "Nonce too high";
      const idx = error.message.indexOf(nonceErr);
      if (error.code === "NONCE_EXPIRED" || idx > -1) {
        this.logger.warn(
          `${this.instanceName} addOrder error: ${side === 0 ? "BUY" : "SELL"}  ${quantity ? quantity.toString() : "undefined"} @ ${
            price ? price.toString() : "undefined"
          } Invalid Nonce `
        );

        await this.correctNonce(this.contracts["SubNetProvider"]);
      } else {
        const reason = await this.getRevertReason(error);
        if (reason) {
          this.logger.warn(
            `${this.instanceName} addOrder error: ${side === 0 ? "BUY" : "SELL"}  ${quantity ? quantity.toString() : "undefined"} @ ${
              price ? price.toString() : "undefined"
            } Revert Reason ${reason}`
          );
        } else {
          this.logger.error(
            `${this.instanceName} addOrder error: ${side === 0 ? "BUY" : "SELL"}  ${quantity ? quantity.toString() : "undefined"} @ ${
              price ? price.toString() : "undefined"
            }`,
            error
          );
        }
      }
    }
  }

  async getClientOrderId(blocknumber = 0, counter = 1): Promise<string> {
    if (blocknumber === 0) {
      blocknumber = (await this.contracts["SubNetProvider"].provider.getBlockNumber()) || 0;
    }
    const timestamp = new Date().toISOString();
    if (this.account) {
      const id = eutils.toUtf8Bytes(`${this.account}${blocknumber}${timestamp}${counter}`);
      return eutils.keccak256(id);
    }
    return "";
  }

  async getRevertReason(error: any, provider: any = this.contracts["SubNetProvider"]) {
    let reason;
    const idx = error.message.indexOf("VM Exception while processing transaction: reverted ");
    if (idx > -1) {
      //Hardhat revert reason already in the message
      return error.message.substring(idx + 72, idx + 81);
    } else {
      if (!error.transaction) {
        this.logger.warn(`${this.instanceName} getRevertReason: error.transaction is undefined`);
      } else {
        //https://gist.github.com/gluk64/fdea559472d957f1138ed93bcbc6f78a
        const code = await provider.provider.call(error.transaction, error.blockNumber);
        reason = ethers.utils.toUtf8String("0x" + code.substr(138));
        const i = reason.indexOf("\0"); // delete all null characters after the string
        if (i > -1) {
          return reason.substring(0, i);
        }
      }
    }
    return reason;
  }

  async getOptions(provider: any = this.contracts["SubNetProvider"], gasEstimate: BigNumberEthers = BigNumberEthers.from(700000)) {
    const gasPx = await this.getGasPrice(provider);
    const maxFeePerGas = Math.ceil(gasPx.mul(105).div(100).toNumber());
    const gasLimit = Math.min(gasEstimate.mul(102).div(100).toNumber(), 30000000); // Block Gas Limit 30M
    const optionsWithNonce = { gasLimit, maxFeePerGas, maxPriorityFeePerGas: 1, nonce: 0 };

    optionsWithNonce.nonce = provider.nonce++;
    return optionsWithNonce;
  }

  isNative(symbol: string, envType: string) {
    const env = this.getEnvironment(envType);
    return env.native_token_symbol === symbol;
  }

  async getTCost(gasEstimate: BigNumberEthers) {
    const gasPrice = await this.getGasPrice(this.contracts["SubNetProvider"]);
    const px = await this.getAlotPrice();
    return utils.formatUnitsToNumber(gasPrice.mul(gasEstimate), 18) * px;
  }

  async getAddOrderGasEstimate(
    clientOrderId: string,
    price: BigNumber,
    quantity: BigNumber,
    side: number,
    ordtype: number,
    ordType2: number
  ) {
    return this.tradePair.estimateGas.addOrder(
      this.account,
      clientOrderId,
      this.tradePairByte32,
      utils.parseUnits(price.toFixed(this.quoteDisplayDecimals), this.contracts[this.quote].tokenDetails.evmdecimals),
      utils.parseUnits(quantity.toFixed(this.baseDisplayDecimals), this.contracts[this.base].tokenDetails.evmdecimals),
      side,
      ordtype,
      ordType2
    );
  }

  async getAddOrderListGasEstimate(
    clientOrderIds: string[],
    prices: BigNumberEthers[],
    quantities: BigNumberEthers[],
    sides: number[],
    type2s: number[]
  ) {
    return this.tradePair.estimateGas.addLimitOrderList(this.tradePairByte32, clientOrderIds, prices, quantities, sides, type2s);
  }

  async getCancelReplaceOrderGasEstimate(orderId: string, clientOrderId: string, price: BigNumberEthers, quantity: BigNumberEthers) {
    return this.tradePair.estimateGas.cancelReplaceOrder(orderId, clientOrderId, price, quantity);
  }

  async getCancelOrderGasEstimate(order: any) {
    return this.tradePair.estimateGas.cancelOrder(order.id);
  }

  async getCancelAllOrdersGasEstimate(orderIds: string[]) {
    return this.tradePair.estimateGas.cancelOrderList(orderIds);
  }

  async getGasPriceInGwei(provider: any = this.contracts["SubNetProvider"]) {
    const gasPx = await this.getGasPrice(provider);
    return gasPx.div(1e9).toNumber();
  }

  async getGasPrice(provider: any) {
    let gasPx;
    if (getConfig("NODE_ENV_SETTINGS") === "localdb-hh" || getConfig("NODE_ENV_SETTINGS") === "dev1-hh") {
      gasPx = BigNumberEthers.from(25000000000);
    } else {
      gasPx = await provider.provider.getGasPrice();
    }
    return gasPx;
  }

  async correctNonce(provider: any) {
    try {
      const expectedNonce = await provider.provider.getTransactionCount(this.account);
      provider.nonce = expectedNonce;
    } catch (error) {
      this.logger.error(`${this.instanceName} 'Error during nonce correction`, error);
    }
  }

  async getWalletBalance(tokenDetails: any, provider: any, envType = "subnet") {
    let balance;
    if (this.isNative(tokenDetails.symbol, envType)) {
      balance = await provider.getBalance(this.account);
    } else {
      if (envType === "mainnet") {
        balance = await this.contracts[tokenDetails.symbol].deployedContract.balanceOf(this.account);
      } else {
        balance = BigNumberEthers.from(0);
      }
    }
    return balance;
  }

  async getBalances() {
    try {
      const portfolio = this.contracts["PortfolioSub"].deployedContract;

      //Chain Avax wallet
      let tokenDetails = this.contracts["AVAX"].tokenDetails;
      let bal = await this.contracts["MainnetProvider"].provider.getBalance(this.account);
      //this.contracts["AVAX"].mainnetBal = utils.formatUnits(bal, 18);
      this.contracts["AVAX"].mainnetBal = utils.formatUnits(bal, 18);

      bal = await portfolio.getBalance(this.account, this.contracts["AVAX"].inByte32); //baseBal
      this.contracts["AVAX"].portfolioTot = utils.formatUnits(bal.total, tokenDetails.evmdecimals);
      this.contracts["AVAX"].portfolioAvail = utils.formatUnits(bal.available, tokenDetails.evmdecimals);

      utils.printBalances(this.account, "AVAX", this.contracts["AVAX"]);

      // if (this.contracts["AVAX"].mainnetBal <= this.getSettingValue('LOW_AVAX_CHAIN_BALANCE') ) {
      //   let text= "*****************" +  this.instanceName + " LOW AVAX Chain Balance for account :" + this.account ;
      //   text = text + utils.lineBreak + '*****************************************************************************************';
      //   text = text + utils.lineBreak + 'LOW AVAX Chain Balance, you will not be able pay for gas fees soon unless you replenish your account. Current Balance: ' + this.contracts["AVAX"].mainnetBal;
      //   text = text + utils.lineBreak + '*****************************************************************************************'+ utils.lineBreak;
      //   this.logger.warn (`${text}`);
      // }

      tokenDetails = this.contracts["ALOT"].tokenDetails;
      bal = await this.getWalletBalance(tokenDetails, this.contracts["MainnetProvider"].provider, "mainnet");
      this.contracts["ALOT"].mainnetBal = utils.formatUnits(bal, tokenDetails.evmdecimals);

      bal = await this.getWalletBalance(tokenDetails, this.contracts["SubNetProvider"].provider, "subnet");
      this.contracts["ALOT"].subnetBal = utils.formatUnits(bal, tokenDetails.evmdecimals);

      bal = await portfolio.getBalance(this.account, this.contracts["ALOT"].inByte32); //baseBal
      this.contracts["ALOT"].portfolioTot = utils.formatUnits(bal.total, tokenDetails.evmdecimals);
      this.contracts["ALOT"].portfolioAvail = utils.formatUnits(bal.available, tokenDetails.evmdecimals);

      utils.printBalances(this.account, "ALOT", this.contracts["ALOT"]);

      if (this.contracts["ALOT"].subnetBal <= this.getSettingValue("LOW_AVAX_CHAIN_BALANCE")) {
        let text = "*****************" + this.instanceName + " LOW AVAX Chain Balance for account :" + this.account;
        text = text + utils.lineBreak + "*****************************************************************************************";
        text =
          text +
          utils.lineBreak +
          "LOW AVAX Chain Balance, you will not be able pay for gas fees soon unless you replenish your account. Current Balance: " +
          this.contracts["ALOT"].subnetBal;
        text =
          text +
          utils.lineBreak +
          "*****************************************************************************************" +
          utils.lineBreak;
        this.logger.warn(`${text}`);
      }

      //Chain Base wallet
      if (this.base !== "AVAX" && this.base !== "ALOT") {
        tokenDetails = this.contracts[this.base].tokenDetails;
        bal = await this.getWalletBalance(tokenDetails, this.contracts["MainnetProvider"].provider, "mainnet");
        this.contracts[this.base].mainnetBal = utils.formatUnits(bal, tokenDetails.evmdecimals);

        bal = await portfolio.getBalance(this.account, this.contracts[this.base].inByte32); //baseBal
        this.contracts[this.base].portfolioTot = utils.formatUnits(bal.total, tokenDetails.evmdecimals);
        this.contracts[this.base].portfolioAvail = utils.formatUnits(bal.available, tokenDetails.evmdecimals);

        utils.printBalances(this.account, this.base, this.contracts[this.base]);
      }

      if (this.quote !== "AVAX" && this.quote !== "ALOT") {
        //Chain Quote wallet
        tokenDetails = this.contracts[this.quote].tokenDetails;
        bal = await this.getWalletBalance(tokenDetails, this.contracts["MainnetProvider"].provider, "mainnet");
        this.contracts[this.quote].mainnetBal = utils.formatUnits(bal, tokenDetails.evmdecimals);

        bal = await portfolio.getBalance(this.account, this.contracts[this.quote].inByte32); //quoteBal
        this.contracts[this.quote].portfolioTot = utils.formatUnits(bal.total, tokenDetails.evmdecimals);
        this.contracts[this.quote].portfolioAvail = utils.formatUnits(bal.available, tokenDetails.evmdecimals);
        utils.printBalances(this.account, this.quote, this.contracts[this.quote]);
      }
    } catch (error) {
      this.logger.error(`${this.instanceName} Error during  getBalance`, error);
    }
  }

  makeOrder(
    traderaddress: any,
    pair: any,
    id: any,
    clientOrderId: any,
    price: any,
    totalamount: any,
    quantity: any,
    side: any,
    type1: any,
    type2: any,
    status: any,
    quantityfilled: any,
    totalfee: any,
    tx: any,
    blocknbr: any,
    gasUsed: any,
    gasPrice: any,
    cumulativeGasUsed: any
  ): any {
    return new Order({
      id,
      clientOrderId,
      traderaddress,
      quantity: new BigNumber(utils.formatUnits(quantity.toString(), this.contracts[this.base].tokenDetails.evmdecimals)),
      pair: utils.toUtf8(pair),
      tx,
      price: new BigNumber(utils.formatUnits(price.toString(), this.contracts[this.quote].tokenDetails.evmdecimals)),
      side: parseInt(side),
      type: parseInt(type1),
      type2: parseInt(type2),
      status: parseInt(status),
      quantityfilled: new BigNumber(utils.formatUnits(quantityfilled.toString(), this.contracts[this.base].tokenDetails.evmdecimals)),
      totalamount: new BigNumber(utils.formatUnits(totalamount.toString(), this.contracts[this.quote].tokenDetails.evmdecimals)),
      totalfee: new BigNumber(
        parseInt(side) === 0
          ? utils.formatUnits(totalfee.toString(), this.contracts[this.base].tokenDetails.evmdecimals)
          : utils.formatUnits(totalfee.toString(), this.contracts[this.quote].tokenDetails.evmdecimals)
      ),
      blocknbr,
      gasUsed,
      gasPrice: utils.formatUnits(gasPrice, 9),
      cumulativeGasUsed
    });
  }

  async processPending(tx: any, event: any) {
    this.logger.warn(`${this.instanceName} processPending  ${tx} event ${event}`);
  }

  async processOrders(
    version: any,
    traderaddress: any,
    pair: any,
    orderId: any,
    clientOrderId: any,
    price: any,
    totalamount: any,
    quantity: any,
    side: any,
    type1: any,
    type2: any,
    status: any,
    quantityfilled: any,
    totalfee: any,
    code: any,
    event: any
  ) {
    try {
      if (pair === this.tradePairByte32) {
        const tx = await event.getTransactionReceipt();

        const order = this.makeOrder(
          traderaddress,
          pair,
          orderId,
          clientOrderId,
          price,
          totalamount,
          quantity,
          side,
          type1,
          type2,
          status,
          quantityfilled,
          totalfee,
          event.transactionHash,
          event.blockNumber,
          tx.gasUsed.toString(),
          tx.effectiveGasPrice ? tx.effectiveGasPrice.toString() : "225",
          tx.cumulativeGasUsed.toString()
        );

        if (utils.statusMap[order.status] === "NEW" || utils.statusMap[order.status] === "PARTIAL") {
          this.addOrderToMap(order);
        } else if (utils.statusMap[order.status] === "FILLED" || utils.statusMap[order.status] === "CANCELED") {
          this.removeOrderFromMap(order);
        }
      }
    } catch (error) {
      this.logger.error(`${this.instanceName} Error during  processOrders`, error);
    }
  }

  addOrderToMap(order: any) {
    if (!order) {
      return;
    }
    const existingOrder = this.orders.get(order.clientOrderId);
    if (existingOrder) {
      if (order.status === existingOrder.status && order.quantityfilled.eq(existingOrder.quantityfilled)) {
        //The same Order event received from the txReceipt & also from the listener. Ignore
        this.logger.debug(
          `${this.instanceName} Duplicate Order event: ${order.clientOrderId} ${order.pair} ${
            order.side === 0 ? "BUY" : "SELL"
          } ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`
        );
      } else {
        // There is a change in the order
        if (order.quantityfilled.gt(existingOrder.quantityfilled)) {
          // Against a stale/delayed event that has quantityfilled <= existing quantityfilled
          this.setLastExecution(order, order.quantityfilled.minus(existingOrder.quantityfilled).toNumber(), order.side === 0 ? 1 : 0);
          this.orders.set(order.clientOrderId, order);
          this.orderbook.change(order);
          if (this.PNL) {
            this.PNL.addOrder(order);
          }
          this.logger.debug(
            `${this.instanceName} Update Order event: ${order.clientOrderId} ${order.pair} ${
              order.side === 0 ? "BUY" : "SELL"
            } ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`
          );
        } else if (order.status !== existingOrder.status && existingOrder.id === "") {
          //PENDING To NEW status transition
          this.logger.debug(
            `${this.instanceName} Order Accepted: ${order.clientOrderId} ${order.pair} ${
              order.side === 0 ? "BUY" : "SELL"
            } ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`
          );
          existingOrder.status = order.status;
          existingOrder.id = order.id;
        }
      }
    } else {
      this.orders.set(order.clientOrderId, order);
      //if status===PENDING the order is only in our local orderbook
      this.orderbook.add(order);
      if (order.quantityfilled.gt(0)) {
        this.setLastExecution(order, order.quantityfilled.toNumber(), order.side);
      }
      if (this.PNL) {
        this.PNL.addOrder(order);
      }
      //this.logger.debug (`${this.instanceName} New Order event: ${order.clientOrderId} ${order.pair} ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);
    }
  }

  setLastExecution(order: any, quantity: any, takerSide: number) {
    this.lastExecution = { price: order.price.toNumber(), quantity, takerSide };
  }

  removeOrderByClOrdId(clientOrderId: string) {
    const existingOrder = this.orders.get(clientOrderId);
    if (existingOrder && existingOrder.status === 9) {
      this.orders.delete(clientOrderId);
      this.orderbook.remove(existingOrder);
    }
  }

  removeOrderFromMap(order: any) {
    if (!order) {
      return;
    }
    const existingOrder = this.orders.get(order.clientOrderId);
    if (existingOrder) {
      if (order.quantityfilled.gt(existingOrder.quantityfilled)) {
        this.setLastExecution(order, order.quantityfilled.minus(existingOrder.quantityfilled).toNumber(), order.side === 0 ? 1 : 0);
      }
      this.orders.delete(order.clientOrderId);
      this.orderbook.remove(order);
      if (this.PNL) {
        this.PNL.addOrder(order);
      }
      //const order =  this.orders.get(order.clientOrderId);
      this.logger.debug(
        `${this.instanceName} removeOrderFromMap Filled/Canceled Order event: ${order.clientOrderId} ${order.pair} ${
          order.side === 0 ? "BUY" : "SELL"
        } ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`
      );
    } else {
      this.setLastExecution(order, order.quantityfilled.toNumber(), order.side);
      //this.logger.debug (`${this.instanceName} removeOrderFromMap Filled/Canceled Order event, Order Not Found: ${order.clientOrderId} ${order.pair} ${order.side === 0 ? 'BUY' :'SELL'} ${order.quantity.toString()} @ ${order.price.toString()} ${utils.statusMap[order.status]}`);
    }
  }

  async cancelOrderList(orderIds: string[] = [], nbrofOrderstoCancel = 30) {
    try {
      if (orderIds.length === 0) {
        let i = 0;
        for (const order of this.orders.values()) {
          orderIds.push(order.id);
          i++;
          if (i >= nbrofOrderstoCancel) {
            // More than xx orders in a cancel will run out of gas
            break;
          }
        }
      }

      //const orderIds = Array.from(this.orders.keys());
      if (orderIds.length > 0) {
        this.orderCount++;
        this.logger.warn(`${this.instanceName} Cancelling all outstanding orders, OrderNbr ${this.orderCount}`);
        const gasest = await this.getCancelAllOrdersGasEstimate(orderIds);
        const tx = await this.tradePair.cancelOrderList(orderIds, await this.getOptions(this.contracts["SubNetProvider"], gasest));

        //const tx = await this.race({ promise:oderCancel , count: this.orderCount} );
        //const orderLog = await tx.wait();
        //const orderLog =  await this.race({ promise: tx.wait(), count: this.orderCount} );
        const orderLog = await tx.wait();
        if (orderLog) {
          for (const _log of orderLog.events) {
            if (_log.event) {
              if (_log.event === "OrderStatusChanged") {
                if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                  await this.processOrders(
                    _log.args.version,
                    this.account,
                    _log.args.pair,
                    _log.args.orderId,
                    _log.args.clientOrderId,
                    _log.args.price,
                    _log.args.totalamount,
                    _log.args.quantity,
                    _log.args.side,
                    _log.args.type1,
                    _log.args.type2,
                    _log.args.status,
                    _log.args.quantityfilled,
                    _log.args.totalfee,
                    _log.args.code,
                    _log
                  );
                }
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`${this.instanceName} Error during  CancelAll`, error);
    }
  }

  async cancelAllIndividually() {
    try {
      for (const order of this.orders.values()) {
        await this.cancelOrder(order);
      }
    } catch (error) {
      this.logger.error(`${this.instanceName} Error during  cancelAllIndividually`, error);
    }
  }

  async cancelOrder(order: any) {
    try {
      const gasest = await this.getCancelOrderGasEstimate(order);

      this.logger.debug(`${this.instanceName} Cancel order gasEstimate: ${gasest} `); // ${tcost}
      this.orderCount++;
      this.logger.debug(
        `${this.instanceName} canceling OrderNbr: ${this.orderCount} ${
          order.side === 0 ? "BUY" : "SELL"
        } ::: ${order.quantity.toString()} ${this.base} @ ${order.price.toString()} ${this.quote}`
      );
      const options = await this.getOptions(this.contracts["SubNetProvider"], gasest);
      const tx = await this.tradePair.cancelOrder(order.id, options);
      //const tx = await this.race({ promise:oderCancel , count: this.orderCount} );
      //const orderLog = await this.race({ promise: tx.wait(), count: this.orderCount} );
      const orderLog = await tx.wait();

      if (orderLog) {
        for (const _log of orderLog.events) {
          if (_log.event) {
            if (_log.event === "OrderStatusChanged") {
              if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                await this.processOrders(
                  _log.args.version,
                  this.account,
                  _log.args.pair,
                  _log.args.orderId,
                  _log.args.clientOrderId,
                  _log.args.price,
                  _log.args.totalamount,
                  _log.args.quantity,
                  _log.args.side,
                  _log.args.type1,
                  _log.args.type2,
                  _log.args.status,
                  _log.args.quantityfilled,
                  _log.args.totalfee,
                  _log.args.code,
                  _log
                );
              }
            }
          }
        }
      }
      return true;
    } catch (error: any) {
      const nonceErr = "Nonce too high";
      const idx = error.message.indexOf(nonceErr);
      if (error.code === "NONCE_EXPIRED" || idx > -1) {
        this.logger.warn(
          `${this.instanceName} Order Cancel error ${order.side === 0 ? "BUY" : "SELL"} ::: ${order.quantity.toFixed(
            this.baseDisplayDecimals
          )} @ ${order.price.toFixed(this.quoteDisplayDecimals)} Invalid Nonce`
        );
        await this.correctNonce(this.contracts["SubNetProvider"]);
      } else {
        const reason = await this.getRevertReason(error);
        if (reason) {
          if (reason === "T-OAEX-01") {
            this.removeOrderFromMap(order);
          }
          this.logger.warn(
            `${this.instanceName} Order Cancel error ${order.side === 0 ? "BUY" : "SELL"} ::: ${order.quantity.toFixed(
              this.baseDisplayDecimals
            )} @ ${order.price.toFixed(this.quoteDisplayDecimals)} Revert Reason ${reason}`
          );
        } else {
          this.logger.error(
            `${this.instanceName} Order Cancel error ${order.side === 0 ? "BUY" : "SELL"} ::: ${order.quantity.toFixed(
              this.baseDisplayDecimals
            )} @ ${order.price.toFixed(this.quoteDisplayDecimals)}`,
            error
          );
        }
      }
      return false;
    }
  }

  async cancelReplaceOrder(order: any, quantity: BigNumber, price: BigNumber) {
    if (!this.status) {
      return;
    }

    try {

      this.checkWashTrade(order.side, price);

      const priceToSend = utils.parseUnits(price.toFixed(this.quoteDisplayDecimals), this.contracts[this.quote].tokenDetails.evmdecimals);
      const quantityToSend = utils.parseUnits(
        quantity.toFixed(this.baseDisplayDecimals),
        this.contracts[this.base].tokenDetails.evmdecimals
      );
      const clientOrderId = await this.getClientOrderId();
      // Not using the gasEstimate because it fails with P-AFNE1 when funds are tight but the actual C/R doesn't

      // const gasest= await this.getCancelReplaceOrderGasEstimate(order.id, clientOrderId ,priceToSend, quantityToSend);
      // this.logger.debug (`${this.instanceName} CancelReplace order gasEstimate: ${gasest} `); // ${tcost}
      this.orderCount++;
      this.logger.debug(
        `${this.instanceName} Cancel/Replace OrderNbr: ${this.orderCount} ${
          order.side === 0 ? "BUY" : "SELL"
        } ::: ${order.quantity.toString()} ${this.base} @ ${order.price.toString()} ${this.quote}`
      );
      const options = await this.getOptions(this.contracts["SubNetProvider"], BigNumberEthers.from(1000000));
      const tx = await this.tradePair.cancelReplaceOrder(order.id, clientOrderId, priceToSend, quantityToSend, options);
      const orderLog = await tx.wait();

      if (orderLog) {
        for (const _log of orderLog.events) {
          if (_log.event) {
            if (_log.event === "OrderStatusChanged") {
              if (_log.args.traderaddress === this.account && _log.args.pair === this.tradePairByte32) {
                await this.processOrders(
                  _log.args.version,
                  this.account,
                  _log.args.pair,
                  _log.args.orderId,
                  _log.args.clientOrderId,
                  _log.args.price,
                  _log.args.totalamount,
                  _log.args.quantity,
                  _log.args.side,
                  _log.args.type1,
                  _log.args.type2,
                  _log.args.status,
                  _log.args.quantityfilled,
                  _log.args.totalfee,
                  _log.args.code,
                  _log
                );
              }
            }
          }
        }
      }
      return true;
    } catch (error: any) {
      const nonceErr = "Nonce too high";
      const idx = error.message.indexOf(nonceErr);
      if (error.code === "NONCE_EXPIRED" || idx > -1) {
        this.logger.warn(
          `${this.instanceName} Order Cancel/Replace error ${order.side === 0 ? "BUY" : "SELL"} ::: ${order.quantity.toFixed(
            this.baseDisplayDecimals
          )} @ ${order.price.toFixed(this.quoteDisplayDecimals)} Invalid Nonce`
        );
        await this.correctNonce(this.contracts["SubNetProvider"]);
      } else {
        const reason = await this.getRevertReason(error);
        if (reason) {
          if (reason === "T-OAEX-01") {
            this.removeOrderFromMap(order);
          }
          this.logger.warn(
            `${this.instanceName} Order Cancel/Replace error ${order.side === 0 ? "BUY" : "SELL"} ::: ${order.quantity.toFixed(
              this.baseDisplayDecimals
            )} @ ${order.price.toFixed(this.quoteDisplayDecimals)} Revert Reason ${reason}`
          );
        } else {
          this.logger.error(
            `${this.instanceName} Order Cancel/Replace error ${order.side === 0 ? "BUY" : "SELL"} ::: ${order.quantity.toFixed(
              this.baseDisplayDecimals
            )} @ ${order.price.toFixed(this.quoteDisplayDecimals)}`,
            error
          );
        }
      }
      return false;
    }
  }
  //FIXME Gas usage is not returned from db. Enhance it to have it available for this as well.
  //Otherwise PNL will not reflect the Gas used for the recovered orders. (Possibly small impact)
  async getOpenOrders() {
    try {
      const orders: any = (await axios.get(signedApiUrl + "orders?pair=" + this.tradePairIdentifier + "&category=0", this.axiosConfig))
        .data;
      return orders.rows;
    } catch (error: any) {
      this.logger.error(`${this.instanceName} ${error}`);
    }
  }

  async processOpenOrders() {
    this.logger.info(`${this.instanceName} Recovering open orders:`);
    const orders = await this.getOpenOrders();
    for (const order of orders) {
      const orderfromDb = new Order({
        id: order.id,
        clientOrderId: order.clientordid,
        traderaddress: order.traderaddress,
        quantity: new BigNumber(order.quantity),
        pair: order.pair,
        price: new BigNumber(order.price),
        side: parseInt(order.side),
        type: parseInt(order.type),
        type2: parseInt(order.type2),
        status: parseInt(order.status),
        quantityfilled: new BigNumber(order.quantityfilled),
        totalamount: new BigNumber(order.totalamount),
        totalfee: new BigNumber(order.totalfee),
        gasUsed: 0,
        gasPrice: 0,
        cumulativeGasUsed: 0
      });

      this.addOrderToMap(orderfromDb);
    }
    await this.checkOrdersInChain();
    this.logger.info(`${this.instanceName} open orders recovered:`);
  }

  // Check the satus of the outstanding orders and remove if filled/canceled
  // If Live add the order to PNL
  async checkOrdersInChain() {
    const promises: any = [];
    const orders: any = [];
    for (const order of this.orders.values()) {
      orders.push(order);
      promises.push(this.tradePair.getOrder(order.id));
    }
    try {
      const results = await Promise.all(promises);
      for (let i = 0; i < results.length; i++) {
        this.checkOrderInChain(orders[i], results[i]);
        this.logger.debug(
          `${this.instanceName} checkOrdersInChain: ${orders[i].side === 0 ? "BUY" : "SELL"} ${orders[i].quantity.toString()} ${
            this.base
          } @ ${orders[i].price.toString()} ${utils.statusMap[orders[i].status]}`
        );
      }
    } catch (error) {
      throw new Error("Could not fetch order status");
    }
  }

  checkOrderInChain(orderinMemory: any, orderInChain: any) {
    try {
      const order = this.makeOrder(
        orderInChain.traderaddress,
        this.tradePairByte32,
        orderInChain.id,
        orderInChain.clientOrderId,
        orderInChain.price,
        orderInChain.totalAmount,
        orderInChain.quantity,
        orderInChain.side,
        orderInChain.type1,
        orderInChain.type2,
        orderInChain.status,
        orderInChain.quantityFilled,
        orderInChain.totalFee,
        "",
        "",
        "0",
        "0",
        "0"
      ); //tx, blocknbr , gasUsed, gasPrice, cumulativeGasUsed) ;

      const ordstatus = orderInChain.status;

      if (
        orderInChain.id === ADDRESS0 || // Order Not found- must have been removed.
        utils.statusMap[ordstatus] === "FILLED" ||
        utils.statusMap[ordstatus] === "CANCELED"
      ) {
        this.logger.warn(
          `${this.instanceName} checkOrderInChain: Order filled/cancelled Removing order  ${order.id} ${
            order.side === 0 ? "BUY" : "SELL"
          } Status : ${orderInChain.id === ADDRESS0 ? "NOTFOUND" : utils.statusMap[ordstatus]}`
        );
        this.removeOrderFromMap(orderinMemory);
        return false;
      } else {
        if (orderinMemory && (orderinMemory.status != orderInChain.status || order.quantityfilled.gt(orderinMemory.quantityfilled))) {
          this.logger.warn(`${this.instanceName} checkOrderInChain: Intermediary message may have been missed ${order.id} ${
            order.side === 0 ? "BUY" : "SELL"
          } Status on chain: ${utils.statusMap[order.status]}
          Qty Filled on chain: ${order.quantity.toFixed(this.baseDisplayDecimals)} Qty Filled in mem:  ${orderinMemory.quantity.toFixed(
            this.baseDisplayDecimals
          )} ,Status in mem: ${utils.statusMap[orderinMemory.status]}`);
          this.addOrderToMap(order);
        }
        return true;
      }
    } catch (error: any) {
      this.logger.error(`${this.instanceName} Error during checkOrderInChain ${orderinMemory.clientOrderId}`, error);
      return false;
    }
  }

  async depositToken(contract: any, symbolByte32: string, decimals: number, deposit_amount: any) {
    const tx1 = await contract.approve(
      this.contracts["PortfolioMain"].address,
      utils.parseUnits(deposit_amount.toString(), decimals),
      await this.getOptions(this.contracts["MainnetProvider"])
    );
    const log = await tx1.wait();
    if (this.PNL) {
      this.PNL.addDepositWithdrawGas(log);
    }
    const tx = await this.contracts["PortfolioMain"].deployedContract.depositToken(
      this.account,
      symbolByte32,
      utils.parseUnits(deposit_amount.toString(), decimals),
      0,
      await this.getOptions(this.contracts["MainnetProvider"])
    );
    const log2 = await tx.wait();
    if (this.PNL) {
      this.PNL.addDepositWithdrawGas(log2);
    }
  }

  async depositNative(portfolio: any, deposit_amount: any, decimals: number) {
    const tx = await this.contracts["MainnetWallet"].sendTransaction({
      to: portfolio.address,
      value: utils.parseUnits(deposit_amount.toString(), decimals),
      gasLimit: 3000000,
      nonce: this.contracts["MainnetProvider"].nonce++
    });
    const log = await tx.wait();
    if (this.PNL) {
      this.PNL.addDepositWithdrawGas(log);
    }
  }

  async withdrawNative(portfolio: any, withdrawal_amount: any, decimals: number) {
    const tx = await portfolio.withdrawNative(
      this.account,
      utils.parseUnits(withdrawal_amount.toString(), decimals),
      await this.getOptions()
    );
    const log = await tx.wait();
    if (this.PNL) {
      this.PNL.addDepositWithdrawGas(log);
    }
  }

  async withdrawToken(withdrawal_amount: any, symbolByte32: string, decimals: number) {
    const tx = await this.contracts["PortfolioSub"].deployedContract.withdrawToken(
      this.account,
      symbolByte32,
      utils.parseUnits(withdrawal_amount.toString(), decimals),
      0,
      await this.getOptions()
    );
    const log = await tx.wait();
    if (this.PNL) {
      this.PNL.addDepositWithdrawGas(log);
    }
  }

  async getBookwithLoop(side: number, nPrice = 2): Promise<any> {
    if (this.tradePair === undefined) {
      this.logger.error("GetBookErr: Contract connection not ready yet.!");
      return { buyBook: [], sellBook: [] };
    }
    const map1 = new Map<string, OrderBookRecordRaw>();
    let price = BigNumberEthers.from(0);
    let lastOrderId = utils.fromUtf8("");
    let book;
    let i;
    const nOrder = 50;
    this.logger.debug(`getBookwithLoop called ${this.tradePairIdentifier} ${side}: `);

    let k = 0;
    let total = BigNumberEthers.from(0);
    do {
      try {
        book = await this.tradePair.getNBook(this.tradePairByte32, side, nPrice, nOrder, price.toString(), lastOrderId);
      } catch (error) {
        this.logger.error(`${this.tradePairIdentifier} ,getBookwithLoop  ${side} pass :  ${k} `, error);
      }

      price = book[2];
      lastOrderId = book[3];

      k += 1;

      let currentRecord;
      for (i = 0; i < book[0].length; i++) {
        if (book[0][i].eq(0)) {
          //console.log (i);
          break;
        } else {
          const key = book[0][i].toString();
          //total.add(book[1][i]);
          if (map1.has(key)) {
            currentRecord = map1.get(key);
            if (currentRecord) {
              currentRecord.quantity = book[1][i].add(currentRecord.quantity);
            }
          } else {
            map1.set(key, {
              price: book[0][i],
              quantity: book[1][i],
              total
            });
          }
        }
      }
    } while ((price.gt(0) || lastOrderId != utils.fromUtf8("")) && book[0].length != nPrice);

    const orderbook: any[] = Array.from(map1.values());

    //Calc Totals orderbook.length>0 ? orderbook[0].quantity:

    for (i = 0; i < orderbook.length; i++) {
      total = total.add(orderbook[i].quantity);
      orderbook[i].total = Number(utils.formatUnits(total, this.contracts[this.base].tokenDetails.evmdecimals));
      orderbook[i].price = Number(utils.formatUnits(orderbook[i].price, this.contracts[this.quote].tokenDetails.evmdecimals));
      orderbook[i].quantity = Number(utils.formatUnits(orderbook[i].quantity, this.contracts[this.base].tokenDetails.evmdecimals));
      this.logger.silly(
        `${this.tradePairIdentifier}  ${side} : After Sum ${total} Price: ${orderbook[i].price}, Qty: ${orderbook[i].quantity}, Total: ${orderbook[i].total}`
      );
    }

    return orderbook;
  }

  async getBookfromChain(): Promise<OrderBookRaw | null> {
    if (this.tradePair === undefined) {
      this.logger.error("GetBookErr: Contract connection not ready yet.!");
      return null;
    }

    try {
      const rawBuyBook = await this.getBookwithLoop(0);
      const rawSellBook = await this.getBookwithLoop(1);

      const orderbookRaw: OrderBookRaw = {
        buyBook: rawBuyBook,
        sellBook: rawSellBook
      };
      this.chainOrderbook = orderbookRaw;
      return orderbookRaw;
    } catch (error) {
      this.logger.error("GetBook Err", error);
      return null;
    }
  }

  // Returns 0,0 if there is no order in the book for the empty array indexes. if 1 data point requested(best Bid, bestAsk) [0,0]
  async getBookfromChain2() {
    try {
      const borders = await this.tradePair.getNBook(this.tradePairByte32, 0, 2, 50, 0, utils.fromUtf8(""));
      const sorders = await this.tradePair.getNBook(this.tradePairByte32, 1, 2, 50, 0, utils.fromUtf8(""));

      const buyOrderArray = [];
      const sellOrderArray = [];

      sellOrderArray.push(sorders[0].toString(), sorders[1].toString());
      buyOrderArray.push(borders[0].toString(), borders[1].toString());
      return { buyBook: buyOrderArray, sellBook: sellOrderArray };
    } catch (error) {
      this.logger.error(`${this.instanceName} Error during getBookfromChain`, error);
    }
  }

  // returns true if any transfers happened from wallet to portfolio and need to refresh balances
  async doInitialFunding(): Promise<boolean> {
    // if any deposits/withdrawals are done,  balances are also refreshed
    const result = await this.fundPortfolioDollarNeutral();
    return result;
  }

  async fundPortfolioDollarNeutral(): Promise<boolean> {
    let deposit_amount: string;
    let amount = 0;
    let withdraw_amount: string;

    await this.getNewMarketPrice();

    const baseCapital = this.getBaseCapital();
    const quoteCapital = this.getQuoteCapital();

    let refreshBalances = false;
    this.logger.info(
      `${this.instanceName} fundPortfolioDollarNeutral called! Calculated BaseCap ${baseCapital} ${this.base} Calculated QuoteCap ${quoteCapital} ${this.quote}`
    );
    try {
      if (
        !(
          getConfig("NODE_ENV_SETTINGS") === "localdb-hh" ||
          getConfig("NODE_ENV_SETTINGS") === "dev1-hh" ||
          getConfig("NODE_ENV_SETTINGS").indexOf("multiapp") > -1
        )
      ) {
        const alot = this.contracts["ALOT"];
        if (alot.subnetBal < 10) {
          deposit_amount = (10 - alot.subnetBal).toFixed(5);
          if (alot.portfolioAvail > 10) {
            await this.withdrawNative(this.contracts["Portfoliosub"].deployedContract, deposit_amount, alot.tokenDetails.evmdecimals);
          } else {
            await this.depositToken(alot.deployedContract, alot.inByte32, alot.tokenDetails.evmdecimals, deposit_amount);
          }
        }
      }
      if (this.portfolioRebalanceAtStart === true) {
        //BASE
        if (
          this.contracts[this.base].portfolioTot < baseCapital * (1 - this.rebalancePct) ||
          this.contracts[this.base].portfolioTot > baseCapital * (1 + this.rebalancePct)
        ) {
          amount = baseCapital - parseFloat(this.contracts[this.base].portfolioTot); // - parseFloat(this.contracts[this.base].portfolioAvail);
          deposit_amount = amount.toFixed(this.baseDisplayDecimals);
          if (amount > 0) {
            //Deposit
            if (Number(this.contracts[this.base].mainnetBal) > amount) {
              if (this.isNative(this.base, "mainnet")) {
                await this.depositNative(
                  this.contracts["PortfolioMain"].deployedContract,
                  deposit_amount,
                  this.contracts[this.base].tokenDetails.evmdecimals
                );
              } else {
                await this.depositToken(
                  this.contracts[this.base].deployedContract,
                  this.contracts[this.base].inByte32,
                  this.contracts[this.base].tokenDetails.evmdecimals,
                  deposit_amount
                );
              }
              this.logger.info(`${this.instanceName} Approved: ${this.account} to deposit ${this.base} ${deposit_amount} to portfolio.`);
              refreshBalances = true;
            } else {
              this.logger.error(
                `${this.instanceName} Can not deposit additional funds to portfolio, not enough funds in Chain. Bal: ${this.base} ${
                  this.contracts[this.base].mainnetBal
                } Deposit Required: ${deposit_amount} `
              );
            }
          } else {
            //withdrawal ..
            // withdraw_amount = Math.abs(amount).toFixed(this.baseDisplayDecimals);
            // if (this.contracts[this.base].portfolioTot  > Math.abs(amount) ) {
            //   if (this.isNative(this.base)) {
            //     await this.withdrawNative(this.contracts["PortfolioMain"].deployedContract, withdraw_amount, this.contracts[this.base].tokenDetails.evmdecimals)
            //   } else {
            //     await this.withdrawToken(withdraw_amount, this.contracts[this.base].inByte32, this.contracts[this.base].tokenDetails.evmdecimals);
            //   }
            //   this.logger.info (`${this.instanceName} Approved: ${this.account} to withdraw ${this.base} ${withdraw_amount} from portfolio.`);
            //   refreshBalances = true;
            // } else {
            //   this.logger.error (`${this.instanceName} Can not withdraw funds from portfolio, not enough funds in Portfolio. Bal: ${this.base} ${this.contracts[this.base].portfolioTot } Withdraw Required: ${withdraw_amount} `);
            // }
          }
        } else {
          this.logger.info(`${this.instanceName} No Deposit/Withdraw needed for ${this.base}`);
        }

        //QUOTE
        if (
          this.contracts[this.quote].portfolioTot < quoteCapital * (1 - this.rebalancePct) ||
          this.contracts[this.quote].portfolioTot > quoteCapital * (1 + this.rebalancePct)
        ) {
          amount = quoteCapital - parseFloat(this.contracts[this.quote].portfolioTot); // - parseFloat(this.contracts[this.quote].portfolioAvail);
          deposit_amount = amount.toFixed(this.quoteDisplayDecimals);
          if (amount > 0) {
            //Deposit
            if (Number(this.contracts[this.quote].mainnetBal) > amount) {
              if (this.isNative(this.quote, "mainnet")) {
                await this.depositNative(
                  this.contracts["PortfolioMain"].deployedContract,
                  deposit_amount,
                  this.contracts[this.quote].tokenDetails.evmdecimals
                );
              } else {
                await this.depositToken(
                  this.contracts[this.quote].deployedContract,
                  this.contracts[this.quote].inByte32,
                  this.contracts[this.quote].tokenDetails.evmdecimals,
                  deposit_amount
                );
              }
              this.logger.info(`${this.instanceName} Approved: ${this.account} to deposit ${this.quote} ${deposit_amount} to portfolio.`);
              refreshBalances = true;
            } else {
              this.logger.error(
                `${this.instanceName} Can not deposit additional funds to portfolio, not enough funds in Chain. Bal: ${this.quote} ${
                  this.contracts[this.quote].mainnetBal
                } Deposit Required: ${deposit_amount} `
              );
            }
          } else {
            //withdrawal ..
            // withdraw_amount = Math.abs(amount).toFixed(this.quoteDisplayDecimals);
            // if (this.contracts[this.quote].portfolioTot > Math.abs(amount)) {
            //   if (this.isNative(this.quote)) {
            //     await this.withdrawNative(this.contracts["PortfolioSub"].deployedContract, withdraw_amount, this.contracts[this.quote].tokenDetails.evmdecimals);
            //   } else {
            //     await this.withdrawToken(withdraw_amount, this.contracts[this.quote].inByte32, this.contracts[this.quote].tokenDetails.evmdecimals);
            //   }
            //   this.logger.info (`${this.instanceName} Approved: ${this.account} to withdraw ${this.quote} ${withdraw_amount} from portfolio.`);
            //   refreshBalances = true;
            // } else {
            //   this.logger.error (`${this.instanceName} Can not withdraw funds from portfolio, not enough funds in Portfolio. Bal: ${this.quote} ${this.contracts[this.quote].portfolioTot} Withdraw Required: ${withdraw_amount}`);
            //  }
          }
        } else {
          this.logger.info(`${this.instanceName} No Deposit/Withdraw needed for ${this.quote}`);
        }
        if (refreshBalances) {
          await this.getBalances();
          await this.correctNonce(this.contracts["MainnetProvider"]);
        }
        return refreshBalances;
      } else {
        return false;
      }
    } catch (error: any) {
      const nonceErr = "Nonce too high";
      const idx = error.message.indexOf(nonceErr);
      if (error.code === "NONCE_EXPIRED" || idx > -1) {
        this.logger.warn(`${this.instanceName} Deposit/Withdrawal error: ${this.account} Invalid Nonce`);
        await this.correctNonce(this.contracts["MainnetProvider"]);
      } else {
        const reason = await this.getRevertReason(error, this.contracts["MainnetProvider"]);
        if (reason) {
          this.logger.warn(`${this.instanceName} Deposit/Withdrawal error: ${this.account} Revert Reason ${reason}`);
        } else {
          this.logger.error(`${this.instanceName} Deposit/Withdrawal error: ${this.account}`, error);
        }
      }
      return false;
    }
  }

  async checkWashTrade(side: number, price: BigNumber) {
    if (this.washTradeCheck) {
      if (side === 0){
        const myBestbid = this.orderbook.bestbid();
        if (myBestbid) {
          const order = this.orders.get(myBestbid.orders[0].clientOrderId);
          if (order && price.lte(order.price)) {
            this.logger.warn(
              `${this.instanceName} 'Wash trade not allowed. New SELL order price ${price.toFixed(
                this.quoteDisplayDecimals
              )} <= Best Bid ${order.price.toString()}`
            );
            return;
          }
        }
      } else if (side === 1){
        const myBestbid = this.orderbook.bestbid();
        if (myBestbid) {
          const order = this.orders.get(myBestbid.orders[0].clientOrderId);
          if (order && price.lte(order.price)) {
            this.logger.warn(
              `${this.instanceName} 'Wash trade not allowed. New SELL order price ${price.toFixed(
                this.quoteDisplayDecimals
              )} <= Best Bid ${order.price.toString()}`
            );
            return;
          }
        }
      }
      
    }
  }

  async cleanUpAndExit() {
    if (!this.cleanupCalled) {
      this.logger.warn(`${this.instanceName} === Process Exit Called === `);
      this.cleanupCalled = true;
      this.stop();
      const timeout = Math.max(7, this.getSettingValue("CLEAR_TIMOUT_SECONDS") || 10); //Min 6 seconds because this.stop calls cancelall and waits for 5 seconds
      setTimeout(() => {
        this.logger.warn(`${this.instanceName} === SHUTTING DOWN === `);
        process.exit(0);
      }, timeout * 1000);
    }
  }
}

export default AbstractBot;
