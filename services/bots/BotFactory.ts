import MarketMakerBot from "./MarketMakerBot";
const Bot:any = MarketMakerBot;

module.exports = {
    createBot(type:any, attributes:any) {
        return new Bot(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};
