class Nonce{
    private counter;
    constructor(){
        this.counter = new Date().getTime();
    }
    public getNonce = () =>{
        return this.counter++;
    }
}

export default new Nonce();
