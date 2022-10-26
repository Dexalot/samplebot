import OrderBookRecordRaw from "./orderBookRecordRaw";

export default interface OrderBookRaw {
  buyBook: OrderBookRecordRaw[];
  sellBook: OrderBookRecordRaw[];
}
