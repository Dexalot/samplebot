import { BigNumber } from "ethers";

export default interface OrderBookRecordRaw {
  price: BigNumber;
  quantity: BigNumber;
  total:BigNumber;
}
