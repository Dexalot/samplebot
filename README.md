## Sample Bot

```
yarn install
```

make sure to have the .env.samplebot in the following. You can supply the private key encrypted or plain text

{
  "bot_id" : "100",
  "pair" : "AVAX/USDT.e",
  "bot_type" : "SampleBot",
  "private_key" : "51dda7beacb289d7eaaed575c3aeexxxxxxxxxxxxxx",
  "account_no" : "0x051A4F2EBFb9d57D3655581xxxxxxxxxxxxx"
}

Feel free to change the sampleBot or add a new bot type that extends AbstractBot. if it is a new bot , add it to the BotFactory.ts and the bot_type in the above
.env file should reflect the new bot_type


## To run

```
yarn sampleBot
```


