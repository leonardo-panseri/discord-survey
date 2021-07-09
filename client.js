// Use Discord.js lib https://discord.js.org/#/docs/main/stable/general/welcome
const Discord = require('discord.js');
// Use Winston logger https://github.com/winstonjs/winston
const winston = require('winston');
// Use Node.js file system
const fs = require('fs');
const util = require('util');

//Import config
let config = require('./config');

function reloadConfig() {
    config = require('./config');
}

function getPrefix() {
    return config["prefix"] + " ";
}

function getMessage(id, ...param) {
    return util.format.apply(util, [config["messages"][id]].concat(param));
}

const surveyCache = new Map();
const messageCache = new Map();

const tempSurvey = [];

// Configure logger settings
const logger = winston.createLogger({
    level: 'debug',
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.colorize(),
                winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`))
        }),
        new winston.transports.File({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)),
            filename: 'logs/bot.log',
            maxsize: '5242880', //5 MB
            maxFiles: '3'
        })
    ],
    exitOnError: false
});

// Initialize Discord Bot
const bot = new Discord.Client();
bot.on('ready', () => {
    logger.info("Logged in as " + bot.user.tag + " in " + bot.guilds.cache.size + " servers");

    bot.guilds.cache.forEach(server => {
        loadData(server, true);
    });
});

bot.on("messageReactionAdd", async (reaction, user) => {
    if(user.bot) return;

    if(reaction.emoji.name === config["reaction"]) {
        messageCache.get(reaction.message.guild.id).forEach((messageId, surveyName) => {
            if (messageId === reaction.message.id) {
                reaction.users.remove(user)
                    .then(() => {
                        startSurvey(reaction.message.guild, surveyName, user);
                    });
            }
        });
    }
});

bot.on('message', async message => {
    if(message.author.bot) return;

    const prefix = getPrefix();
    if(message.content.substr(0, prefix.length) === prefix && message.guild !== null) {
        if(message.member.hasPermission("ADMINISTRATOR")) {
            handleCommand(message)
        }
    }
});

function handleCommand(fullCommand) {
    const args = fullCommand.content.slice(getPrefix().length).trim().split(" ");
    const command = args[0].toLowerCase();
    args.shift();

    switch(command) {
        case "create":
            if(args.length === 1) {
                const name = args[0];
                createSurvey(fullCommand, name);
            } else {
                sendEmbedToChannel(fullCommand.channel, "RED", getMessage("command_syntax_error",
                    getPrefix() + 'create <survey_name>'))
            }
            break;
        case "reload":
            reload(fullCommand);
            break;
        case "set_channel":
            if(args.length === 1) {
                const surveyName = args[0];
                setResponseChannel(fullCommand, surveyName);
            } else {
                sendEmbedToChannel(fullCommand.channel, "RED", getMessage("command_syntax_error",
                    getPrefix() + 'set_channel <survey_name>'))
            }
            break;
        case "set_message":
            if(args.length === 2) {
                const messageId = args[0];
                const surveyName = args[1];
                setSurveyMessage(fullCommand, messageId, surveyName);
            } else {
                sendEmbedToChannel(fullCommand.channel, "RED", getMessage("command_syntax_error",
                    getPrefix() + 'set_message <message_id> <survey_name>'))
            }
            break;
        case "help":
            fullCommand.channel.send(new Discord.MessageEmbed()
                .setTitle("SurveyBot Help")
                .addField(getPrefix() + "create <survey_name>", "Create a new survey for this server with the specified name")
                .addField(getPrefix() + "reload", "Reload configuration and data file for the current server")
                .addField(getPrefix() + 'set_channel <survey_name>', "Set the channel where the responses for the specified survey will be posted")
                .addField(getPrefix() + 'set_message <message_id> <survey_name>' , "Set the message with the specified ID as the starting point for the specified survey"))
                .catch(() => {});
            break;
    }
}

function createSurvey(command, name) {
    const server = command.guild;
    const channel = command.channel;
    let data = getCacheData(server);
    data[name] = {response_channel: "",
        message: "",
        questions: ["Question1", "Question2", "Question3"]};
        saveData(server, data, true);
        sendEmbedToChannel(channel, "GREEN", getMessage("survey_create_success",
            'data/' + server.id + '.json', getPrefix() + 'reload'));
}

function reload(command) {
    loadData(command.guild, true);

    reloadConfig();

    sendEmbedToChannel(command.channel, "GREEN", getMessage("reload_success"));
}

function setResponseChannel(command, surveyName) {
    const server = command.guild;
    const channel = command.channel;

    if(surveyExists(server, surveyName)) {
        let data = getCacheData(server);
        data[surveyName]["response_channel"] = command.channel.id;
        saveData(server, data, true);
        sendEmbedToChannel(channel, "GREEN", getMessage("set_channel_success", surveyName));
    } else {
        sendEmbedToChannel(channel, "RED", getMessage("invalid_survey", surveyName))
    }
}

function setSurveyMessage(command, messageId, surveyName) {
    const server = command.guild;
    const channel = command.channel;

    command.channel.messages.fetch(messageId)
        .then(message => {
            if(surveyExists(server, surveyName)) {
                let data = getCacheData(server);
                data[surveyName]["message"] = messageId;

                message.react(config["reaction"])
                    .then(() => {
                        saveData(server, data, true);
                        sendEmbedToChannel(channel, "GREEN", getMessage("set_message_success", surveyName));
                    })
                    .catch(() => sendEmbedToChannel(channel, "RED", getMessage("set_message_reaction_failure")));
            } else {
                sendEmbedToChannel(channel, "RED", getMessage("invalid_survey", surveyName));
            }
        })
        .catch(() => sendEmbedToChannel(channel, "RED", getMessage("set_message_invalid_message")));
}

/*WHITE, AQUA, GREEN, BLUE, YELLOW, PURPLE, LUMINOUS_VIVID_PINK, GOLD, ORANGE, RED, GREY, DARKER_GREY, NAVY, DARK_AQUA,
DARK_GREEN, DARK_BLUE, DARK_PURPLE, DARK_VIVID_PINK, DARK_GOLD, DARK_ORANGE, DARK_RED, DARK_GREY, LIGHT_GREY, DARK_NAVY,
 RANDOM*/
function sendEmbedToChannel(channel, color, text) {
    if(text !== "") {
        channel.send(new Discord.MessageEmbed()
            .setColor(color)
            .setDescription(text));
    }
}

function startSurvey(server, surveyName, user) {
    if(surveyExists(server, surveyName)) {
        const questions = surveyCache.get(server.id)[surveyName]["questions"];
        const responseChannelId = surveyCache.get(server.id)[surveyName]["response_channel"];
        const response = [""];

        let responseChannel = server.channels.resolve(responseChannelId);

        if (responseChannel != null) {
            user.createDM()
                .then(dmChannel => {
                    if (tempSurvey.indexOf(user.id) === -1) {
                        tempSurvey.push(user.id);

                        let questionIndex = 0;
                        dmChannel.send(new Discord.MessageEmbed()
                            .setColor("DARK_AQUA")
                            .setDescription(questions[questionIndex]))
                            .then(() => {
                                questionIndex++;

                                const collector = dmChannel.createMessageCollector(msg => msg.content.length !== 0 || msg.attachments.size !== 0, {time: config["timeout"]});

                                collector.on('collect', m => {
                                    let question = questions[questionIndex - 1];
                                    let answer = m.content;
                                    m.attachments.forEach(attachment => answer += attachment.url);

                                    const newEntry = "__" + question + "__\n" + answer + "\n\n";
                                    if(response[response.length - 1].length + newEntry.length > 2048) {
                                        response.push(newEntry);
                                    } else {
                                        response[response.length - 1] += newEntry;
                                    }

                                    if (questionIndex < questions.length) {
                                        dmChannel.send(new Discord.MessageEmbed()
                                            .setColor("DARK_AQUA")
                                            .setDescription(questions[questionIndex]))
                                            .catch(err => logger.error(err));
                                        questionIndex++;
                                    } else {
                                        collector.stop("END");
                                    }
                                });

                                collector.on('end', (collected, reason) => {
                                    if (reason === "END") {
                                        response.forEach(resp => {
                                            if(resp.charAt(resp.length - 1) === "\n" && resp.charAt(resp.length - 2) === "\n")
                                                resp = resp.substring(0, resp.length - 2);
                                            responseChannel.send(new Discord.MessageEmbed()
                                                .setTitle(surveyName + " - " + user.username)
                                                .setColor("DARK_AQUA")
                                                .setDescription(resp));
                                        });

                                        dmChannel.send(new Discord.MessageEmbed()
                                            .setColor("GREEN")
                                            .setDescription(getMessage("survey_complete")))
                                            .catch(() => {
                                            });
                                    } else {
                                        dmChannel.send(new Discord.MessageEmbed()
                                            .setColor("RED")
                                            .setDescription(getMessage("timeout")))
                                            .catch(() => {
                                            });
                                    }

                                    tempSurvey.splice(tempSurvey.indexOf(user.id), 1);
                                });
                            })
                            .catch(() => tempSurvey.splice(tempSurvey.indexOf(user.id), 1));
                    }
                });
        }
    }
}



function surveyExists(server, surveyName) {
    return surveyCache.get(server.id) !== undefined && surveyCache.get(server.id)[surveyName] !== undefined;
}

function getCacheData(server) {
    return Object.assign({}, surveyCache.get(server.id));
}

function saveCacheData(server, data) {
    surveyCache.set(server.id, data);

    let messages = messageCache.get(server.id) === undefined ? new Map() : messageCache.get(server.id);
    for(const surveyName in data) {
        if(data.hasOwnProperty(surveyName)) {
            const messageId = data[surveyName]["message"];
            if(messageId !== "") {
                server.channels.cache.forEach(channel => {
                    if(channel instanceof Discord.TextChannel) {
                        channel.messages.fetch(messageId)
                            .then(message => {
                                if(message !== undefined) {
                                    messages.set(surveyName, messageId);
                                }
                            })
                            .catch(() => {});
                    }
                });

            }
        }
    }
    messageCache.set(server.id, messages);
}

function loadData(server, saveToCache=false) {
    fs.readFile('data/' + server.id + '.json','utf8',(err,data) => {
        if(err) {
            data = "{}";
            if(err.message.search("ENOENT") !== -1) {
                fs.writeFile('data/' + server.id + '.json', data, (err1) => {
                    if(err1) logger.error("Can't create data file for server " + server.name + " !\n" + err1);
                });
            } else logger.error("Can't read data file for server " + server.name + " !\n" + err);
        }

        data = JSON.parse(data);

        if(saveToCache) saveCacheData(server, data);

        return data;
    });
}

function saveData(server, data, saveToCache=false) {
    const json = JSON.stringify(data, null, 2);
    fs.writeFile('data/' + server.id + '.json', json, err => {
        if(err) {
            logger.error(err);
        }

        if(saveToCache) saveCacheData(server, data);
    });

}

process.on('SIGINT', () => disconnectBot());
process.on('SIGTERM', () => disconnectBot());
process.on('SIGHUP', () => disconnectBot());
process.on('SIGBREAK', () => disconnectBot());

function disconnectBot() {
    bot.destroy();
    logger.info("Bot disconnected");

    process.exit()
}

bot.login(config["token"]);
