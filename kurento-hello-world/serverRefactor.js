const path = require('path');
const url = require('url');
const cookieParser = require('cookie-parser')
const express = require('express');
const session = require('express-session')
const minimist = require('minimist');
// const moment = require('moment');
const ws = require('ws');
const kurento = require('kurento-client');
const fs = require('fs');
const https = require('https');
const errors = require('./errors');

const argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});

const options = {
    key: fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
};

const app = express();

/*
 * Management of sessions
 */
app.use(cookieParser());

const sessionHandler = session({
    secret: 'none',
    rolling: true,
    resave: true,
    saveUninitialized: true
});

app.use(sessionHandler);

/*
 * Definition of global variables.
 */
const sessions = {};
const candidatesQueue = {};
let kurentoClient = null;

/*
 * Server startup
 */
const asUrl = url.parse(argv.as_uri);
const port = asUrl.port;
const server = https.createServer(options, app).listen(port, function () {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

let wss = new ws.Server({
    server: server,
    path: '/helloworld'
});

/*
 * Kurento types
 */
const kurentoTypes = {
    WEBRTC_ENDPOINT: 'WebRtcEndpoint',
    RECORDER_ENDPOINT: 'RecorderEndpoint',
    MEDIA_PIPELINE: 'MediaPipeline',
};

/*
 * Management of WebSocket messages
 */
wss.on('connection', function (ws, req) {
    let sessionId = null;
    let request = req;
    let response = {
        writeHead: {}
    };

    sessionHandler(request, response, function (err) {
        sessionId = request.session.id;
        console.log('Connection received with sessionId ' + sessionId);
    });

    ws.on('error', function (error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function () {
        console.log("🚀 ~ file: serverRefactor.js:84 ~ ws.on ~ sessionId", sessionId)
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function (_message) {
        const message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
            case 'start':
                sessionId = request.session.id;
                start(sessionId, ws, message.sdpOffer, message.type).
                    then(sdpAnswer => {
                        ws.send(JSON.stringify({
                            id: 'startResponse',
                            sdpAnswer: sdpAnswer
                        }));
                    })
                    .catch(error => {
                        errorHandler(error, ws);
                    });
                break;
            case 'stop':
                stop(sessionId);
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.candidate);
                break;

            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message ' + message
                }));
                break;
        }
    });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoCLient() {
    return new Promise((resolve, reject) => {
        if (kurentoClient !== null) return resolve(kurentoClient);

        kurento(argv.ws_uri, (error, _kurentoClient) => {
            if (error) {
                const err = errors.NO_MEDIA_SERVER
                err.message = err.message + argv.ws_uri;
                err.message = err.message + ". Exiting with error " + error;

                return reject(err);
            }
            resolve(_kurentoClient);
        });
    });
}

function kurentoClientCreate(type, kurentoClient) { // type = 'MediaPipeline'
    return new Promise((resolve, reject) => {
        kurentoClient.create(type, (error, element) => {
            if (error) {
                const err = errors.KURENTO_CLIENT_CREATE
                err.message = error

                return reject(err);
            }

            resolve(element);
        });
    });
}

function createMediaElements(pipeline, type) {
    return new Promise((resolve, reject) => {
        let mediaProfile = null;

        switch (type) {
            case 'webcam':
                mediaProfile = 'WEBM';
                break;
            case 'screen':
                mediaProfile = 'WEBM_VIDEO_ONLY';
                break;
            default:
                mediaProfile = 'WEBM_VIDEO_ONLY';
                break;
        }

        const elements = [
            { type: kurentoTypes.WEBRTC_ENDPOINT, params: {} },
            {
                type: kurentoTypes.RECORDER_ENDPOINT, params: {
                    uri: `file:///tmp/test-${Date.now().toString()}.webm`, // where to save the video
                    mediaProfile: mediaProfile, // video format
                    stopOnEndOfStream: true, // stop recording when the stream is finished
                    stopTimeOut: 1000, // 1 second using for stopOnEndOfStream
                }
            }
        ];

        pipeline.create(elements, (error, elements) => {
            if (error) {
                pipeline.release();

                const err = errors.CREATE_MEDIA_ELEMENT
                err.message = error;

                return reject(err)
            }

            const webRtcEndpoint = elements[0];
            const recorderEndpoint = elements[1];

            const createdElements = {
                webRtcEndpoint,
                recorderEndpoint
            };

            resolve(createdElements);
        });
    });
}

function connectMediaElementsWithRecorder(pipeline, ws, webRtcEndpoint, recorderEndpoint) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.connect(recorderEndpoint, (error) => {
            if (error) {
                const err = errors.CONNECT_MEDIA_ELEMENTS
                err.message = error;

                pipeline.release();
                ws.send(JSON.stringify({
                    id: 'error',
                    message: err.message
                }));

                return reject(err);
            }

            recorderEndpoint.record((error) => {
                if (error) {
                    const err = errors.RECORD_MEDIA_ELEMENT
                    err.message = error;

                    pipeline.release();
                    ws.send(JSON.stringify({
                        id: 'error',
                        message: err.message
                    }));

                    return reject(err);
                }

                return resolve();
            });
        });
    });
}

function connectMediaElements(webRtcEndpoint, ws) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.connect(webRtcEndpoint, (error) => {
            if (error) {
                const err = errors.CONNECT_MEDIA_ELEMENTS
                err.message = error;

                return reject(err);
            }

            webRtcEndpoint.on('IceCandidateFound', (event) => {
                const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                const message = {
                    id: 'iceCandidate',
                    candidate: candidate
                };
                ws.send(JSON.stringify(message));
            });

            return resolve();
        });
    });
}

function processOffer(webRtcEndpoint, sdpOffer) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
            if (error) {
                const err = errors.PROCESS_OFFER
                err.message = error;

                return reject(err);
            }

            resolve(sdpAnswer);
        });
    });
}

function gatherCandidates(webRtcEndpoint) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.gatherCandidates((error) => {
            if (error) {
                const err = errors.GATHER_CANDIDATES
                err.message = error;

                return reject(err);
            }

            resolve();
        });
    });
}

function stop(sessionId) {
    if (sessions[sessionId]) {
        const pipeline = sessions[sessionId].pipeline;
        pipeline.release();

        delete sessions[sessionId];
        delete candidatesQueue[sessionId];
    }
}

function onIceCandidate(sessionId, _candidate) {
    let candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (sessions[sessionId]) {
        console.info('Sending candidate');
        const webRtcEndpoint = sessions[sessionId].webRtcEndpoint;
        webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}

async function start(sessionId, ws, sdpOffer, type) {
    if (!sessionId) throw errors.NO_SESSION_ID;

    const kurentoClient = await getKurentoCLient();
    const pipeline = await kurentoClientCreate(kurentoTypes.MEDIA_PIPELINE, kurentoClient);
    const { webRtcEndpoint, recorderEndpoint } = await createMediaElements(pipeline, type);

    if (candidatesQueue[sessionId]) {
        while (candidatesQueue[sessionId].length) {
            const candidate = candidatesQueue[sessionId].shift();
            webRtcEndpoint.addIceCandidate(candidate);
        }
    }

    await connectMediaElements(webRtcEndpoint, ws);
    await connectMediaElementsWithRecorder(pipeline, ws, webRtcEndpoint, recorderEndpoint);
    const sdpAnswer = await processOffer(webRtcEndpoint, sdpOffer);
    await gatherCandidates(webRtcEndpoint);

    sessions[sessionId] = {
        'pipeline': pipeline,
        'webRtcEndpoint': webRtcEndpoint
    }

    return sdpAnswer;
}

function errorHandler(err, ws) {
    const message = {
        id: 'error',
        message: err?.message ?? 'unknown error'
    }

    switch (err?.name) {
        case errors.NO_MEDIA_SERVER.name:
            console.log(err.message, 'media server is not running')
            message.message = err.name + ': ' + message.message;
            break;
        case errors.NO_SESSION_ID.name:
            console.log(err.message, 'session id is not defined')
            message.message = err.name + ': ' + message.message;
            break;
        case errors.KURENTO_CLIENT_CREATE.name:
            console.log(err.message, 'error creating kurento client')
            message.message = err.name + ': ' + message.message;
            break;
        case errors.CREATE_MEDIA_ELEMENT.name:
            console.log(err.message, 'error creating media element')
            message.message = err.name + ': ' + message.message;
            break;
        case errors.CONNECT_MEDIA_ELEMENTS.name:
            console.log(err.message, 'error connecting media elements')
            message.message = err.name + ': ' + message.message;
            break;
        case errors.PROCESS_OFFER.name:
            console.log(err.message, 'error processing offer')
            message.message = err.name + ': ' + message.message;
            break;
        case errors.GATHER_CANDIDATES.name:
            console.log(err.message, 'error gathering candidates')
            message.message = err.name + ': ' + message.message;
            break;
        case errors.RECORD_MEDIA_ELEMENT.name:
            console.log(err.message, 'error recording media element')
            message.message = err.name + ': ' + message.message;
            break;
        default:
            break;
    }

    if (ws) ws.send(JSON.stringify(message));
}

app.use(express.static(path.join(__dirname, 'static')));
