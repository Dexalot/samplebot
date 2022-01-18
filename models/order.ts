class Order {
  constructor(options = {}) {
    // ID_USER always comes from the header for security
    Object.assign(this, options);
  }

  static ORDSTATUS = {
    NEW: 0,
    REJECTED: 1,
    PARTIAL: 2,
    FILLED: 3,
    CANCELED: 4,
    EXPIRED: 5,
    KILLED: 6,
    PENDING_NEW: 7
  };
}

export default Order;
