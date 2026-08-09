import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import express from 'express';
import crypto from 'crypto';

const app = express();
const port = process.env.PORT || 3000;

// Get from Github repository webhook
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
// Generate secret in terminal with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// And paste it while creating webhook on Github
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
// Private custom endpoint (/webhook/wiki/<private_endpoint>)
const PRIVATE_ENDPOINT = process.env.PRIVATE_ENDPOINT;
const WEBHOOK_USERNAME = process.env.WEBHOOK_USERNAME;
const WEBHOOK_AVATAR_URL = process.env.WEBHOOK_AVATAR_URL;

app.use(express.static('./public'))
    .use(
        express.json({
            verify: (req, res, buf) => {
                req.rawBody = buf;
            }
        })
    )
    .use((req, res, next) => {
        console.info(`${req.method} request to${req.url}`);
        next();
    });

app.post(`/webhook/wiki${PRIVATE_ENDPOINT ? `/${PRIVATE_ENDPOINT}` : ''}`, async (req, res) => {
    if (GITHUB_WEBHOOK_SECRET) {
        const signature = req.headers['x-hub-signature-256'];
        const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
        const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');

        if (signature !== digest) {
            console.warn('Unauthorized webhook attempt rejected.');
            return res.status(401).send('Unauthorized: Signature mismatch');
        }
    }

    const event = req.headers['x-github-event'];
    if (event === 'ping') {
        return res.status(200).send('Pong! Webhook is active and configured correctly.');
    }
    if (event !== 'gollum') {
        return res.status(200).send('Ignored event type. Only listening for gollum.');
    }

    const payload = req.body;
    const sender = payload.sender.login;
    const repoName = payload.repository.full_name;

    // Safety check: Discord limits messages to a maximum of 10 embeds
    const embeds = payload.pages.slice(0, 10).map(page => {
        return {
            title: `Wiki Page ${page.action === 'created' ? 'Created' : 'Edited'}: ${page.title}`,
            url: page.html_url,
            color: page.action === 'created' ? 0x28a745 : 0x0366d6,
            author: {
                name: sender,
                icon_url: payload.sender.avatar_url,
                url: payload.sender.html_url
            },
            description: `Commit: \`${page.sha.substring(0, 7)}\``
        };
    });

    const webhook = {
        content: `📝 **Wiki update in [${repoName}](${payload.repository.html_url}/wiki)**`,
        embeds: embeds
    };

    if (WEBHOOK_USERNAME) webhook.username = WEBHOOK_USERNAME;
    if (WEBHOOK_AVATAR_URL) webhook.avatar_url = WEBHOOK_AVATAR_URL;

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhook)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Discord API Error:', response.statusText, errorText);
            return res.status(500).send('Failed to relay to Discord');
        }

        res.status(200).send('Successfully delivered to Discord');
    } catch (error) {
        console.error('Network Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Wiki Webhook Relayer running on port ${port}`);
});
