import MarketMakerBot from "./MarketMakerBot";
import TakerBot from "./TakerBot";
const Bot:any = {marketMaker: MarketMakerBot, taker:TakerBot};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};