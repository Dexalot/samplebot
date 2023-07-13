import { BigNumber } from "bignumber.js";

class NewOrder {
    public side: number;
    public quantity: BigNumber;
    public price: BigNumber;
    public level: number;
    constructor(side: number, quantity: BigNumber, price: BigNumber, level: number) {
        this.side = side;
        this.quantity = quantity;
        this.price = price;
        this.level = level;
    }
}

export default NewOrder;
