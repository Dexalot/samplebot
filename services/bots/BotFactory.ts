import avax_usdc from "./avax_usdc";
const Bot:any = {avax_usdc};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};
