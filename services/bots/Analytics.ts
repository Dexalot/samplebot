import axios from "axios";
import { getConfig } from "../../config";
import utils from "../utils";
import BigNumber from "bignumber.js";
import AbstractBot from "./AbstractBot";
import NewOrder from "./classes";

class Analytics extends AbstractBot {

  constructor(botId: number, pairStr: string, privateKey: string) {
    super(botId, pairStr, privateKey);
    this.portfolioRebalanceAtStart = false;
    this.config = getConfig(this.tradePairIdentifier);
  }

  async saveBalancestoDb(balancesRefreshed: boolean): Promise<void> {
    this.logger.info(`${this.instanceName} Save Balances somewhere if needed`);
  }

  async initialize(): Promise<boolean> {
    const initializing = await super.initialize();
    if (initializing) {
      const filledOrders = await this.getFilledOrders(new Date(Date.now()-(86400000*30)).toISOString());
      this.runAnalytics(filledOrders);
      process.exit(1);
      
      return true;
    } else {
      return false;
    }
  }

  runAnalytics (filledOrders: any) {
    let totalCost = 0;
    let totalSold = 0;
    let qtyOutstanding = 0;
    let totalFees = 0;
    let makerBuysQty = 0;
    let makerBuysAmt = 0;
    let makerSellsQty = 0;
    let makerSellsAmt = 0;
    let takerBuysQty = 0;
    let takerBuysAmt = 0;
    let takerSellsQty = 0;
    let takerSellsAmt = 0;
    let totalVolumeQuote = 0;
    let totalVolumeBase = 0;
    let avgBuyPrice = 0;
    let avgSellPrice = 0;
    filledOrders.forEach((e:any) => {
        if (e.type2 == 2 || e.type2 == 3){
            if (e.side == 0){
                qtyOutstanding += parseFloat(e.quantityfilled);
                let fee = e.totalfee * e.price;
                totalFees += fee;
                totalCost += e.quantityfilled * e.price;
                if (e.type2 == 2){
                    takerBuysAmt += e.quantityfilled * e.price;
                    takerBuysQty += e.quantityfilled;
                } else {
                    makerBuysAmt += e.quantityfilled * e.price;
                    makerBuysQty += e.quantityfilled;
                }
            } else if (e.side == 1){
                qtyOutstanding-=parseFloat(e.quantityfilled);
                totalFees += e.totalfee;
                totalSold += e.quantityfilled * e.price
                if (e.type2 == 2){
                    takerSellsAmt += e.quantityfilled * e.price;
                    takerSellsQty += e.quantityfilled;
                    console.log(e);
                } else {
                    makerSellsAmt += e.quantityfilled * e.price;
                    takerSellsQty += e.quantityfilled;
                }
            }
        }
        totalVolumeBase += e.quantityFilled;
        totalVolumeQuote += e.quantityFilled * e.price;
    });
    avgBuyPrice = (takerBuysAmt+makerBuysAmt)/(takerBuysQty+makerBuysQty);
    avgSellPrice = (takerSellsAmt+makerSellsAmt)/(takerSellsQty+makerSellsQty);
    
    console.log("AVG BUY:",avgBuyPrice, "AVG SELL:", avgSellPrice,"QTY OUTSTANDING:",qtyOutstanding,"MAKER BUYS AMT:", makerBuysAmt, "MAKER SELLS AMT:",makerSellsAmt, "TAKER BUYS AMT:", takerBuysAmt, "TAKER SELLS AMT:",takerSellsAmt, "TotalVolumeBase:",totalVolumeBase,"TotalVolumeQuote:",totalVolumeQuote, "TOTAL FEES:", totalFees);
  }

  async startOrderUpdater() {
  }

  // Update the marketPrice from an outside source
  async getNewMarketPrice() {
    return new BigNumber(0);
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
