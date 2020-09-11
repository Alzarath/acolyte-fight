# Acolyte Fight!
Acolyte Fight is no more. This is the source code to Acolyte Fight! It is provided as is. It is probably very hard to run as it probably requires various keys to Google Cloud Platform and Discord to be passed in as environment variables. This is not an example of perfect code, it is an example of realistic code. In reality code has to be written very fast on a small budget and has to change a lot.

# Instructions
You can run this game by itself on your own machine by following the instructions below.

Things to install:
* NodeJS: https://nodejs.org (download and install the LTS (long-term support) version)
* yarn: `npm install -g yarn` (if you're on Windows, type this into PowerShell. If you're on Mac, type this into the Terminal)

How to run:
1. `yarn`
2. `yarn run build`
3. `yarn run server`
4. Go to http://localhost:7770 in your browser

## Development
You may want to use the file watcher, which automatically detects changes to files, rebuilds the code, and restarts the server.

1. `yarn`
2. `yarn start`

The server is coded to work without a database, but some functionality may be limited. To develop this for real, with all features available, you should:
* Create a Google Cloud Platform service account credentials so that the server can use your Firestore database and set your GOOGLE_APPLICATION_CREDENTIALS environment variable to point to your credentials file: https://cloud.google.com/docs/authentication/getting-started
* Create a Discord application and set the DISCORD_SECRET to your Discord app client key: https://discord.com/developers/applications

## Production
The `./build_and_push.sh` bash script will build the server as a docker container and try to push it to my Google Cloud Platform docker registry.
You should change this to your own docker registry.

You should:
* Set the ENIGMA_SECRET environment variable to something that only you know, as this is used to authenticate users.

# License
You may use this codebase in part or in full for any free project, as long as you credit the author. You may not use this in any commercial project or make any money off any part of this codebase without the express permission of the author.

# Author
@raysplaceinspace: https://twitter.com/raysplacenspace

# Discord
Join the Discord: https://discord.gg/sZvgpZk

# Technical notes
The game is a deterministic simulation. The server arbitrates the input sequence and all clients replay the sequence in the same order and should get the same result. The lowest-latency client decides the authoritative world state in case of desyncs, and also runs all the bots. The server is very lightweight, does no simulation, and so should scale to thousands of concurrent clients.

## Coding conventions
* Properties that begin with "ui" are not synced across clients and can be modified non-deterministically.
* Properties that end in XX will be mangled, so that the game is harder to hack.

## Environment variables
Environment variables:
* ENIGMA_SECRET: Set this to whatever you want, it's used to validate authentication among other things. Just once you set it, never change it.
* GOOGLE_APPLICATION_CREDENTIALS: Path to the file with Google Cloud Platform credentials.
* FACEBOOK_SECRET: Not needed, was part of a failed experiment to support Facebook Instant Games login.
* DISCORD_SECRET: Make a Discord app, put secret key here. Allows users to login with Discord.
* HTTPS_KEY, HTTPS_CERT: I used these to run https on my machine, which was necessary to test Discord login. In production, HTTPS terminates at the load balancer so not used in production.

## Google Firestore indexes
Create these Google Firestore indexes:
* game: userIds (ARRAY), unixTimestamp (DESC) - allows game to find old games for a user
