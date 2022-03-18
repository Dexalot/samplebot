import { ethers } from "ethers";
import { getConfig } from "../config";
import { getLogger } from "./logger";
//@ts-ignore
import moment from "moment-timezone";



class utils {
  static logger = getLogger("Utils");

  static assetMap: any = {"0": "NATIVE",
  "1": "ERC20 ",
  "2": "NONE  "}

  static statusMap: any = {"0": "NEW",          // NEW = Order.Status.NEW = 0
      "2": "PARTIAL",      // PARTIAL = Order.Status.PARTIAL = 2
      "3": "FILLED",       // FILLED = Order.Status.FILLED = 3
      "4": "CANCELED"};    // CANCELED = Order.Status.CANCELED = 4

  static sideMap: any = {"BUY": 0 ,            // BUY = Order.Side.BUY = 0
  "SELL": 1 }            // SELL = Order.Side.SELL = 0


  static type1Map = {"0": "MARKET",        // MARKET = Order.Type1.MARKET = 0
  "1": "LIMIT",         // LIMIT = Order.Type1.LIMIT = 0
  "2": "STOP",
  "3": "STOPLIMIT",
  "4" : "LIMITFOK"
}          // STOP = Order.Type1.STOP = 0



  static lineBreak = "\r\n";

  static fixedLengthArray = (length: number): any[] => {
    const array: any[] = [];

    array.push = function () {
      if (this.length >= length) {
        this.shift();
      }
      return Array.prototype.push.apply(this, Array.from(arguments));
    };

    return array;
  };

  static arrayRemove = (array: any[], item: any) => {
    const index = array.indexOf(item);
    if (index > -1) {
      array.splice(index, 1);
    }
  };

  static stripWhiteSpaceFromEnds = (s: string): string => {
    return s.trim();
  };

  static normalizeSymbol = (s: string): string => {
    return utils.stripWhiteSpaceFromEnds(s.toString().toUpperCase());
  };

  static fromUtf8 = (_txt: string): string => {
    return ethers.utils.formatBytes32String(_txt);
  };

  static toUtf8 = (_txt: ethers.utils.BytesLike): string => {
    return ethers.utils.parseBytes32String(_txt);
  };

  static parseUnits = (txt: string, decimals: ethers.BigNumberish): ethers.BigNumber => {
    return ethers.utils.parseUnits(txt, decimals);
  };

  static formatUnits = (wei: ethers.BigNumberish, decimals: ethers.BigNumberish | undefined): string => {
    return ethers.utils.formatUnits(wei, decimals);
  };

  static formatUnitsToNumber = (wei: ethers.BigNumberish, decimals: ethers.BigNumberish | undefined): number => {
    return +ethers.utils.formatUnits(wei, decimals);
  };

  static fromWei = (wei: ethers.BigNumberish): string => {
    return ethers.utils.formatEther(wei);
  };

  static toWei = (wei: string): ethers.BigNumber => {
    return ethers.utils.parseEther(wei);
  };

  static nextRoundMinute = (): Date => {
    // ** WARNING moment is mutable object**
    const m = moment().utc();
    const roundUp = m.second() || m.millisecond() ? m.add(1, "minute").startOf("minute") : m.startOf("minute");
    return roundUp.toDate();
  };

  static nextRoundTimeInterval = (
    lastRoundTime: moment.MomentInput,
    nbrofIntervals: moment.DurationInputArg1,
    interval: moment.unitOfTime.DurationConstructor
  ): Date => {
    //interval =minute or hour
    // ** WARNING moment is mutable object**
    const ltime = moment(lastRoundTime);
    const ntime = ltime.add(nbrofIntervals, interval);
    // outputs Tue Feb 17 2017 12:02:00 GMT+0000
    return ntime.toDate();
  };

  static lastRoundTimeInterval = (interval: moment.unitOfTime.StartOf): Date => {
    //interval =minute or hour
    // ** WARNING moment is mutable object**
    const m = moment().utc();
    const roundDown = m.startOf(interval);
    // outputs Tue Feb 17 2017 12:01:00 GMT+0000
    return roundDown.toDate();
  };

  static periodStart = (nbrofIntervals: number, intervalnum: number, interval: moment.unitOfTime.DurationConstructor): Date => {
    // ** WARNING moment is mutable object**
    let ROUNDING;
    let roundDown: moment.Moment;

    let start = moment()
      .utc()
      .add(-nbrofIntervals * intervalnum, interval);

    if (interval.substring(0, 6) === "minute" && intervalnum > 1) {
      ROUNDING = intervalnum * 60 * 1000;
      start = moment(Math.floor(+start / ROUNDING) * ROUNDING); // Rounds to correct 5, 15, 30  min intervals
      roundDown = start;
    } else {
      roundDown = start.startOf(interval);
    }

    //interval =minute or hour
    // outputs Tue Feb 17 2017 12:01:00 GMT+0000
    return roundDown.toDate();
  };

  static printBalances=(account:string, name:string, res:any, evmdecimals:number):void => {
    //let assetTypeInt = parseInt(res.assetType.toString());
    let assetType = res.assetType.toString();
    console.log("Account: ", account, ":::",
    name, "::", assetType, "::",
    ethers.utils.formatUnits(res.available, evmdecimals), "/",
    ethers.utils.formatUnits(res.total, evmdecimals), "/",
    "[P Avail / P Tot]");
  };


  static sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  static decodeBase64String(data: string): string {
    const buff = Buffer.from(data, "base64");
    return buff.toString("utf8");
  }

  static getBlockChain() :string {
    var blockchain = 'Avalanche';
    if ( getConfig("NODE_ENV_SETTINGS").includes ('-hh' ) )  {
      blockchain='Hardhat';
    }
    return blockchain;
  }

  static randomFromInterval(min:number, max:number, decimalPlaces=2) {  // either positive or negative random number between 2 numbers
    var rand = Math.random()*(max-min) + min;
    var power = Math.pow(10, decimalPlaces);
    var num =  Math.floor(rand*power) / power;
    num *= Math.round(Math.random()) === 0 ? 1 : -1
    return num;
  }

  static randomFromIntervalPositive(min:number, max:number, decimalPlaces=2) {  // either positive or negative random number between 2 numbers
    var rand = Math.random()*(max-min) + min;
    var power = Math.pow(10, decimalPlaces);
    var num =  Math.floor(rand*power) / power;
    return num;
  }


}
export default utils;
