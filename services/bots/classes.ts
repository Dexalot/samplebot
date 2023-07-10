import { BigNumber } from "bignumber.js";

class NewOrder {
    public side: number;
    public quantity: BigNumber;
    public price: BigNumber;
    constructor(side: number, quantity: BigNumber, price: BigNumber) {
        this.side = side;
        this.quantity = quantity;
        this.price = price;
    }
}

export default NewOrder;
