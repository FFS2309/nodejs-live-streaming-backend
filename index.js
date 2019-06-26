var express = require('express')
var app = express()
var bodyParser = require('body-parser');
var ffmpeg = require('fluent-ffmpeg');
var fs = require('fs');
var child_process = require('child_process');
var Eris = require('eris');
const {Readable} = require('stream');
const emitStream = require('emit-stream');
const voiceAudioTransform = require('./VoiceAudioTransform');
const config = require('config.js');

var timemark = null;
var api_key = config.api_key;


var bot = new Eris(config.discord_token);
var bot_ready = false;
bot.on("ready", () => {
    bot_ready = true;
    console.log("Discord bot connected!");
    bot.createMessage("575827712636223500", "Yoo waddup bois?");
});
bot.connect();

function generateFilterComplex(inputs) {
    var def_src = "";
    var def_filter = "";
    for (let i = 0; i < inputs.length; i++) {
        def_src += "[" + i + ":v] setpts=PTS-STARTPTS, scale=" + (inputs[i].res ? inputs[i].res : "640x360") + " [" + inputs[i].name + "];";
        if (i == 1)
            def_filter += "[" + inputs[0].name + "][" + inputs[i].name + "] overlay=1:x=" + (inputs[i].xOff ? inputs[i].xOff : "0") + ":y=" + (inputs[i].yOff ? inputs[i].yOff : "0") + " [tmp" + i + "];";
        if (i < inputs.length - 1 && i > 1) {
            def_filter += "[tmp" + (i - 1) + "][" + inputs[i].name + "] overlay=1:x=" + (inputs[i].xOff ? inputs[i].xOff : "0") + ":y=" + (inputs[i].yOff ? inputs[i].yOff : "0") + " [tmp" + i + "];";
        } else if (i >= inputs.length - 1) {
            def_filter += "[tmp" + (i - 1) + "][" + inputs[i].name + "] overlay=1:x=" + (inputs[i].xOff ? inputs[i].xOff : "0") + ":y=" + (inputs[i].yOff ? inputs[i].yOff : "0");
        }
    }
    return def_src + def_filter;
}

app.use(bodyParser.json());

app.post('/addOBSScene', function (req, res) {
    let token = req.body.token || req.query.token || req.headers['Authorization'];
    if (!token || token != api_key) {
        res.json({'success': false});
        return;
    }
    let body = req.body;
    const TEMPLATE_NAME = body.name;
    let obs_body = body.obs;
    const CURRENT_SCENE = obs_body.current_scene;
    let sources = obs_body.sources;
    let inputs = [];
    let scene_data;
    for (let i = 0; i < sources.length; i++) {
        if (sources[i].id == "scene" && sources[i].name == CURRENT_SCENE) {
            scene_data = sources[i];
            console.log("Found scene " + CURRENT_SCENE);
            break;
        }
    }
    let largest_width = 0;
    let largest_height = 0;
    for (let i = 0; i < scene_data.settings.items.length; i++) {
        for (let j = 0; j < sources.length; j++) {
            if (sources[j].id = "browser_source" && scene_data.settings.items[i].name == sources[j].name) {
                inputs.push({
                    name: sources[j].name,
                    noStreamlink: !(sources[j].settings.url.includes('twitch.tv') || sources[j].settings.url.includes('youtube.com') || sources[j].settings.url.includes('youtu.be')),
                    source: sources[j].settings.url,
                    xOff: scene_data.settings.items[i].pos.x,
                    yOff: scene_data.settings.items[i].pos.y,
                    res: Math.round((sources[j].settings.width || 800) * scene_data.settings.items[i].scale.x) + "x" + Math.round((sources[j].settings.height || 600) * scene_data.settings.items[i].scale.y)
                });
                let width = Math.round(sources[j].settings.width * scene_data.settings.items[i].scale.x);
                let height = Math.round(sources[j].settings.height * scene_data.settings.items[i].scale.y);
                if (width > largest_width) largest_width = Math.round(sources[j].settings.width * scene_data.settings.items[i].scale.x);
                if (height > largest_height) largest_height = Math.round(sources[j].settings.height * scene_data.settings.items[i].scale.y);
                if (scene_data.settings.items[i].pos.x + width > largest_width) largest_width = scene_data.settings.items[i].pos.x + width;
                if (scene_data.settings.items[i].pos.y + height > largest_height) largest_height = scene_data.settings.items[i].pos.y + height;
            }
        }
    }

    let template = {
        name: TEMPLATE_NAME,
        inputs: inputs,
        outres: largest_width + "x" + largest_height,
        filterComplex: generateFilterComplex(inputs)
    };
    fs.writeFile(TEMPLATE_NAME + '.json', JSON.stringify(template), 'utf8');
    res.json({'success': true});

});
app.post('/addTemplate', function (req, res) {
    let token = req.body.token || req.query.token || req.headers['Authorization'];
    if (!token || token != api_key) {
        res.json({'success': false});
        return;
    }
    let body = req.body;
    const OUTPUT_RES = body.output_res || "1280x720";
    const TEMPLATE_NAME = body.name;
    const INPUTS = body.inputs;
    //TODO: WRITE INPUTS AND FILTERCOMPLEX TO JSON FILE
    let template = {
        name: TEMPLATE_NAME,
        inputs: INPUTS,
        outres: OUTPUT_RES,
        filterComplex: generateFilterComplex(INPUTS)
    };
    fs.writeFile(TEMPLATE_NAME + '.json', JSON.stringify(template), 'utf8');
    res.json({'success': true});
});

var encodeCMD;
app.post('/startStream', function (req, res) {
    let token = req.body.token || req.query.token || req.headers['Authorization'];
    if (token != api_key) {
        res.json({'success': false});
        return;
    }
    let body = req.body;
    if (!body.name) res.json({'error': "Template name missing"});
    const TEMPLATE_NAME = body.name;
    let template = JSON.parse(fs.readFileSync(TEMPLATE_NAME + '.json', 'utf8'));
    if (encodeCMD) encodeCMD.kill();
    encodeCMD = ffmpeg();
    encodeCMD.on('end', onEnd)
        .on('progress', onProgress)
        .on('error', onError);
    for (let i = 0; i < template.inputs.length; i++) {
        let src = '';
        if (template.inputs[i].noStreamlink) {
            src = template.inputs[i].source;
        } else {
            try {
                src = child_process.execSync('streamlink --default-stream "720p, best" --stream-url ' + template.inputs[i].source).toString('utf-8').replace('\r', '').replace('\n', '');
            } catch (error) {
                if (error && error.status == 0) res.json({'error': error.message});
                else res.json({'success': false});
                return;
            }
        }
        encodeCMD.addInput(src);
    }
    encodeCMD.complexFilter(template.filterComplex);
    encodeCMD.format('flv');
    encodeCMD.outputOptions([
        '-x264opts nal-hrd=cbr:force-cfr=1:keyint=60:scenecut=0',
        '-preset ultrafast',
        '-pix_fmt yuv420p',
        '-threads 0',
        '-c:v libx264'
    ]);
    encodeCMD.audioChannels(2);
    encodeCMD.videoBitrate('4000k', true);
    bot.createMessage("575827712636223500", "Test");
    console.log("test");
    bot.joinVoiceChannel("575827712636223502").then((conn) => {
        conn.play("http://sourceunpack.gameabusefastcomplete.com/doggy.mp3");
        bot.createMessage("575827712636223500", "Yoo waddup bois?");
        try{
            let voiceStream = conn.receive("opus");
            let readableStream = emitStream(voiceStream);
            readableStream.pipe(voiceAudioTransform());
            //readableStream.resume();
            //encodeCMD.addInput(readableStream).audioCodec("libopus");
            bot.createMessage("575827712636223500", "Test");
            console.log("test");
            encodeCMD.output('rtmp://live-fra.twitch.tv/app/' + config.twitch_stream_key).run();
            bot.createMessage("575827712636223500", "Test");
            console.log("test");
        }catch(e){
            console.log("Error: " + e.message);
        }
        res.json({'success': true});
    }).catch((err)=>{
        bot.createMessage("575827712636223500", "Bruh I\'m dying over here: " + err.message);
    });
    //res.json({'success': false});
});

app.get('/stopStream', function (req, res) {
    let token = req.body.token || req.query.token || req.headers['Authorization'];
    if (!token || token != api_key) {
        res.json({'success': false});
        return;
    }
    if (encodeCMD) encodeCMD.kill();
    bot.disconnect({reconnect: true});
    res.json({'success': true});
});

app.listen(1337);

bot.on("error", (err, id) => {
    console.error("Bot error: " + err.message + "  \n " + JSON.stringify(err));
});

function getReadableStreamFromVoiceStream(voiceStream){
    let readableStream = new Readable();
    readableStream._read = () => {};
    voiceStream.on("data", (data, userID, timestamp, sequence)=>{
        console.log("VOICE PACKET RECEIVED: USER|TIMESTAMP|SEQUENCE-" + userID + "|" + timestamp + "|" + sequence);
        readableStream.push(data);
    });

    return readableStream;
}

function exitHandler(options, exitCode) {
    if (encodeCMD) encodeCMD.kill();
    if (bot_ready) bot.disconnect({reconnect: false});
    if (options.exit) process.exit();
}

function onProgress(progress) {
    if (progress.timemark != timemark) {
        timemark = progress.timemark;
        console.log('Time mark: ' + timemark + "...");
    }
}

function onError(err, stdout, stderr) {
    console.log('Cannot process video: ' + err.message);
    fs.writeFile('ffmpeg-stderr.txt', stderr, 'utf-8', (err) => {
        if (err) console.log(err);
    });
}

function onEnd() {
    console.log('Finished processing');
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {cleanup: true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit: true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit: true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit: true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit: true}));
