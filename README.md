A simple script to process Github Webhook "gollum" (wiki) event and send it to (Discord) webhook.

- Clone the repository: `git clone https://github.com/TF2Autobot/tf2autobot-wiki-watcher`
- Install NPM dependencies: `npm ci`
- Configure the `.env` file.
- Run the script:
    - With PM2: `pm2 start index.js --name "wiki-webhook"`
    - Without PM2: `node index.js`
