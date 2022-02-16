# scalpy-hive

* Clone this repo & cd into it <br>
`git clone https://github.com/louis23412/scalpy-hive.git && cd scalpy-hive` <br>

* Install dependencies <br>
`npm install`

* Open __settings.json__ & change as needed. <br>
   ```
    {
    "updateRate" : 3,
    "candleSize" : 1,
    "candleLimit" : 2000,

    "tradeSize" : 0.999,
    "username" : "usernameHere",
    "pKey" : "privateActiveKeyHere",
    "bKey" : "privatePostingKeyHere"
    }
   ```
   
* Save the config file, then run the bot <br>
   `npm start`