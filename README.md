## Sample Bot

```
yarn install
```

make sure to have the .env.fuji in the following. You can supply the private key encrypted or plain text

{
  "bot_id" : "100",
  "pair" : "AVAX/USDC",
  "bot_type" : "SampleBot",
  "private_key" : "51dda7beacb289d7eaaed575c3aeexxxxxxxxxxxxxx",
  "account_no" : "0x051A4F2EBFb9d57D3655581xxxxxxxxxxxxx"
}


You can get AVAX from fuji faucet and sell your avax against USDC at Dexalot Fuji at https://app.dexalot-test.com

if you need more USDC please contact the Dexalot Team.

## To run

```
yarn sampleBot-fuji
```

## Flow

This sample Bot extends the AbstractBot implementation. AbstractBot performs various functions:
- Get the mainnet/subnet environments, pairs listed, token details from the RESTAPI
- Create references to the necessary contracts
- Deposit initial amounts to the contract from the mainnet for trading (Note it takes about 30 seconds for the deposit to reach the subnet)
- Requests open orders from the RESTAPI in case of crash recovery
- Keeps a list of its outstanding orders, and a local orderbook in memory
- Gets the best 2 bid/asks orderbook from the chain
- It listens to OrderStatusChanged events from the blockchain in case one of its outstading orders gets hit/lifted.
- it also captures OrderStatusChanged event as a part of tx results when sending an order and updates the order status in memory.
The OrderStatusChanged event raised from the blockchain to all the listeners a few seconds later. So the same event is processed twice.
Once when the order is sent out and again when it is received from the blockchain by the independent listener thread.
Hence it is normal to see the message "Duplicate Order event: ......"
- Double Checks the order status from the chain every 10 min, in case an OrderStatusChanged event is missed.


NOTE:
Sample Bot has hardcoded ALOT price in its getNewMarketPrice() function and will send orders using these hardcoded prices.

Feel free to change the sampleBot and/or add a new bot type that extends AbstractBot. if it is a new bot , add it to the BotFactory.ts and the bot_type in the above .env.fuji file

## TO DO
 Listen to tradePairs' Executed event (trades) from the blockchain OR
 Web Socket Connection to Dexalot APIs to receive the orderbook, and trades events instead of getting them from the blockchain.


## DISCLAIMER

This bot is provided for facilitating the integration with Dexalot. It should not be used in PRODUCTION environments unless it is throughly tested.
USE AT YOUR OWN RISK
