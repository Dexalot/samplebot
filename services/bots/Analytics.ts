import axios from "axios";
import { getConfig } from "../../config";
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import NewOrder from "./classes";

class Analytics extends AbstractBot {
    protected startDate: number = 0;
    protected endDate: number = 0;
    protected marketPrice = new BigNumber(0);
    protected baseUsd = 0; 
    protected quoteUsd = 0; 

  constructor(botId: number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
    this.portfolioRebalanceAtStart = false;
    this.config = getConfig(this.tradePairIdentifier);
    this.startDate = parseInt(getConfig("startDate")?getConfig("startDate"):"0");
    this.endDate = parseInt(getConfig("endDate")?getConfig("endDate"):"0");
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
        await this.getNewMarketPrice();
        let startDate = Date.now()-(86400000*30);
        let endDate = Date.now();
      if (this.startDate){
        startDate = this.startDate;
      }
      if (this.endDate){
        endDate = this.endDate;
      }
      const filledOrders = await this.getFilledOrders(new Date(startDate).toISOString(),new Date(endDate).toISOString());
      this.runAnalytics(filledOrders);
      process.exit(1);
      
      return true;
    } else {
      return false;
    }
  }

  runAnalytics (filledOrders: any) {
    let data: any = {};
    data.totalCost = 0;
    data.totalSold = 0;
    data.qtyOutstanding = 0;
    data.totalFees = 0;
    data.makerBuysQty = 0;
    data.makerBuysAmt = 0;
    data.makerSellsQty = 0;
    data.makerSellsAmt = 0;
    data.takerBuysQty = 0;
    data.takerBuysAmt = 0;
    data.takerSellsQty = 0;
    data.takerSellsAmt = 0;
    data.totalVolumeQuote = 0;
    data.totalVolumeBase = 0;
    data.buyFillsMaker = 0;
    data.askFillsMaker = 0;
    data.buyFillsTaker = 0;
    data.askFillsTaker = 0;
    filledOrders.forEach((e:any) => {
        if (e.type2 == 2 || e.type2 == 3){
            if (e.side == 0){
                data.qtyOutstanding += parseFloat(e.quantityfilled);
                let fee = e.totalfee * e.price;
                data.totalFees += fee;
                data.totalCost += e.quantityfilled * e.price;
                if (e.type2 == 2){
                    data.takerBuysAmt += e.quantityfilled * e.price;
                    data.takerBuysQty += parseFloat(e.quantityfilled);
                    data.buyFillsTaker ++;
                } else {
                    data.makerBuysAmt += e.quantityfilled * e.price;
                    data.makerBuysQty += parseFloat(e.quantityfilled);
                    data.buyFillsMaker ++;
                }
            } else if (e.side == 1){
                data.qtyOutstanding-=parseFloat(e.quantityfilled);
                data.totalFees += parseFloat(e.totalfee);
                data.totalSold += e.quantityfilled * e.price
                if (e.type2 == 2){
                    data.takerSellsAmt += e.quantityfilled * e.price;
                    data.takerSellsQty += parseFloat(e.quantityfilled);
                    data.askFillsTaker ++;
                } else {
                    data.makerSellsAmt += e.quantityfilled * e.price;
                    data.makerSellsQty += parseFloat(e.quantityfilled);
                    data.askFillsMaker ++;
                }
            }
        }
        data.totalVolumeBase += parseFloat(e.quantityFilled);
        data.totalVolumeQuote += e.quantityFilled * e.price;
    });
    data.avgBuyPrice = (data.takerBuysAmt+data.makerBuysAmt)/(data.takerBuysQty+data.makerBuysQty);
    data.avgSellPrice = (data.takerSellsAmt+data.makerSellsAmt)/(data.takerSellsQty+data.makerSellsQty);
    data.avgMakerBuyPrice = (data.makerBuysAmt)/(data.makerBuysQty);
    data.avgMakerSellPrice = (data.makerSellsAmt)/(data.makerSellsQty);
    console.log(data);
    // console.log("AVG BUY:",avgBuyPrice, "AVG SELL:", avgSellPrice,"QTY OUTSTANDING:",qtyOutstanding,"MAKER BUYS AMT:", makerBuysAmt, "MAKER SELLS AMT:",makerSellsAmt, "TAKER BUYS AMT:", takerBuysAmt, "TAKER SELLS AMT:",takerSellsAmt, "TotalVolumeBase:",totalVolumeBase,"TotalVolumeQuote:",totalVolumeQuote, "TOTAL FEES:", totalFees);
  }

  async startOrderUpdater() {
  }


  // Update the marketPrice from price feed bot
  async getNewMarketPrice() {
    try {
      let response = await axios.get('http://localhost:3000/prices');
      let prices = response.data;
      

      if (this.base == "sAVAX"){
        this.quoteUsd = prices[this.quote+'-USD']; 
        this.baseUsd = prices['sAVAX-AVAX'] * this.quoteUsd; 
      } else {
        this.baseUsd = prices[this.base+'-USD']; 
        this.quoteUsd = prices[this.quote+'-USD']; 
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
    return new BigNumber(0);
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
    return 0;
  }

  getQuoteCapital(): number {
    return 0;
  }

  getIncrement(): number {
    return 0;
  }
}

export default Analytics;
