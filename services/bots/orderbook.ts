import RBTree from "bintrees";
import BigNumber from "bignumber.js";
import { getLogger } from "../logger";

class Orderbook {
  protected logger;
  protected _ordersByID: any;
  protected _bids: any;
  protected _asks: any;

  constructor() {
    this.logger = getLogger("OrderBook");
    this._ordersByID = {};
    this._bids = new RBTree.RBTree((a: { price: { comparedTo: (arg0: any) => any } }, b: { price: any }) => a.price.comparedTo(b.price));
    this._asks = new RBTree.RBTree((a: { price: { comparedTo: (arg0: any) => any } }, b: { price: any }) => a.price.comparedTo(b.price));
  }

  _getTree(side: number) {
    return side === 0 ? this._bids : this._asks;
  }

  state(book: any = null) {
    if (book) {
      book.bids.forEach((order: any) =>
        this.add({
          clientOrderId: order[2],
          side: 0,
          price: new BigNumber(order[0]),
          quantity: new BigNumber(order[1])
        })
      );

      book.asks.forEach((order: any) =>
        this.add({
          clientOrderId: order[2],
          side: 1,
          price: new BigNumber(order[0]),
          quantity: new BigNumber(order[1])
        })
      );
    } else {
      book = { asks: [], bids: [] };
      this._bids.reach((bid: any) => book.bids.push(...bid.orders));
      this._asks.each((ask: any) => book.asks.push(...ask.orders));

      return book;
    }
  }

  get(clientOrderId: any) {
    return this._ordersByID[clientOrderId];
  }

  bestbid() {
    return this._bids.max();
  }

  bidSize() {
    return this.state().bids.length;
  }
  worstbid() {
    return this._bids.min();
  }

  bestask() {
    return this._asks.min();
  }

  worstask() {
    return this._asks.max();
  }

  askSize() {
    return this.state().asks.length;
  }

  add(order: any) {
    order = {
      clientOrderId: order.clientOrderId,
      side: order.side,
      price: order.price,
      quantity: order.quantity.minus(order.quantityfilled)
    };

    const tree = this._getTree(order.side);
    let node = tree.find({ price: order.price });

    if (!node) {
      node = {
        price: order.price,
        orders: []
      };
      tree.insert(node);
    }

    node.orders.push(order);
    this._ordersByID[order.clientOrderId] = order;
  }

  remove(rorder: any) {
    let order = this.get(rorder.clientOrderId);

    if (!order) {
      this.logger.debug(`${order.clientOrderId} Order not found in Orderbook`);
      order = {
        clientOrderId: rorder.clientOrderId,
        side: rorder.side,
        price: rorder.price,
        quantity: rorder.quantity.minus(rorder.quantityfilled)
      };
    }

    const tree = this._getTree(order.side);
    const node = tree.find({ price: order.price });
    if (node) {
      const { orders } = node;
      orders.splice(orders.indexOf(order), 1);
      if (orders.length === 0) {
        tree.remove(node);
      }
    } else {
      this.logger.debug(`${node} 'rderbook remove , node not found`);
    }
    delete this._ordersByID[order.clientOrderId];
  }

  change(change: any) {
    // price of null indicates market order
    if (change.price === null || change.price === undefined) {
      return;
    }

    // Original code wouldn't allow partials
    const quantity = change.quantity.minus(change.quantityfilled);
    const price = change.price;
    const order = this.get(change.clientOrderId);
    const tree = this._getTree(change.side);
    const node = tree.find({ price });

    if (!node || node.orders.indexOf(order) < 0) {
      return;
    }

    const nodeOrder = node.orders[node.orders.indexOf(order)];

    nodeOrder.quantity = quantity;
    this._ordersByID[nodeOrder.clientOrderId] = nodeOrder;
  }
}

export default Orderbook;
