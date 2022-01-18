const RBTree = require('bintrees').RBTree;
const BigNumber = require('bignumber.js');
const assert = require('assert');

class Orderbook {
  constructor() {
    this._ordersByID = {};
    this._bids = new RBTree((a, b) => a.price.comparedTo(b.price));
    this._asks = new RBTree((a, b) => a.price.comparedTo(b.price));
  }

  _getTree(side) {
    return side === 0 ? this._bids : this._asks;
  }

  state(book) {
    if (book) {
      book.bids.forEach(order =>
        this.add({
          id: order[2],
          side: 0,
          price: BigNumber(order[0]),
          quantity: BigNumber(order[1]),
        })
      );

      book.asks.forEach(order =>
        this.add({
          id: order[2],
          side: 1,
          price: BigNumber(order[0]),
          quantity: BigNumber(order[1]),
        })
      );
    } else {
      book = { asks: [], bids: [] };

      this._bids.reach(bid => book.bids.push(...bid.orders));
      this._asks.each(ask => book.asks.push(...ask.orders));

      return book;
    }
  }

  get(orderId) {
    return this._ordersByID[orderId];
  }

  bestbid() {
    return this._bids.max();
  }

  bidSize() {
    return this._bids.size;
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
    return this._asks.size;
  }

  add(order) {

    order = {
      id:  order.id,
      side: order.side,
      price: order.price,
      quantity: order.quantity.minus(order.quantityfilled),
    };

    const tree = this._getTree(order.side);
    let node = tree.find({ price: order.price });

    if (!node) {
      node = {
        price: order.price,
        orders: [],
      };
      tree.insert(node);
    }

    node.orders.push(order);
    this._ordersByID[order.id] = order;
  }

  remove(rorder) {
    var order = this.get(rorder.id);

    if (!order) {
      console.log('Order not found in Orderbook', order.id);
      console.log ('Using order passed as parameter to orderbook remove function');
      order = {
        id:  rorder.id,
        side: rorder.side,
        price: rorder.price,
        quantity: rorder.quantity.minus(rorder.quantityfilled),
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
      console.log('rderbook remove , node not found')
    }
    delete this._ordersByID[order.id];
  }


  match(match) {
    const quantity = BigNumber(match.quantity);
    const price = BigNumber(match.price);
    const tree = this._getTree(match.side);
    const node = tree.find({ price: price });
    assert(node);

    const order = node.orders.find(ord => ord.id === match.maker_order_id);

    assert(order);

    order.quantity = order.quantity.minus(quantity);
    this._ordersByID[order.id] = order;

    assert(order.quantity >= 0);

    if (order.quantity.eq(0)) {
      this.remove(order);
    }
  }

  change(change) {
    // price of null indicates market order
    if (change.price === null || change.price === undefined) {
      return;
    }

    // Original code wouldn't allow partials (1) see below ???
    const quantity = change.quantity.minus(change.quantityfilled);
    const price = change.price;
    const order = this.get(change.id);
    const tree = this._getTree(change.side);
    const node = tree.find({ price });

    if (!node || node.orders.indexOf(order) < 0) {
      return;
    }

    const nodeOrder = node.orders[node.orders.indexOf(order)];

    // (1) from above. Because partials were not allowed, this assertion is not valid.
    // const newSize = parseFloat(order.quantity);
    // const oldSize = parseFloat(change.quantity);
    // assert.equal(oldSize, newSize);

    nodeOrder.quantity = quantity;
    this._ordersByID[nodeOrder.id] = nodeOrder;
  }
}

module.exports = exports = Orderbook;
