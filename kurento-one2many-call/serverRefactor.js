/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

const path = require('path');
const url = require('url');
const express = require('express');
const minimist = require('minimist');
const ws = require('ws');
const kurento = require('kurento-client');
const fs = require('fs');
const https = require('https');

const argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});

const options =
{
    key: fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
};

const app = express();

/*
 * Definition of global variables.
 */
let idCounter = 0;
let candidatesQueue = {};
let kurentoClient = null;
let presenter = null;
let viewers = [];
const noPresenterMessage = 'No active presenter. Try again later...';

/*
 * Server startup
 */
const asUrl = url.parse(argv.as_uri);
const port = asUrl.port;
const server = https.createServer(options, app).listen(port, function () {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

const wss = new ws.Server({
    server: server,
    path: '/one2many'
});

function nextUniqueId() {
    idCounter++;
    return idCounter.toString();
}

/*
 * Management of WebSocket messages
 */
wss.on('connection', function (ws) {

    var sessionId = nextUniqueId();
    console.log('Connection received with sessionId ' + sessionId);

    ws.on('error', function (error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function () {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function (_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
            case 'presenter':
                startPresenterPromise(sessionId, ws, message.sdpOffer)
                    .then(sdpAnswer => {
                        ws.send(JSON.stringify({
                            id: 'presenterResponse',
                            response: 'accepted',
                            sdpAnswer: sdpAnswer
                        }));
                    })
                    .catch(error => {
                        ws.send(JSON.stringify({
                            id: 'presenterResponse',
                            response: 'rejected',
                            message: error.name + ': '+ error.message
                        }));
                    });
                break;

            case 'viewer':
                startViewerPromise(sessionId, ws, message.sdpOffer)
                    .then(sdpAnswer => {
                        ws.send(JSON.stringify({
                            id: 'viewerResponse',
                            response: 'accepted',
                            sdpAnswer: sdpAnswer
                        }));
                    })
                    .catch(error => {
                        ws.send(JSON.stringify({
                            id: 'viewerResponse',
                            response: 'rejected',
                            message: error.name + ': '+ error.message
                        }));
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
function clearCandidatesQueue(sessionId) {
    if (candidatesQueue[sessionId]) {
        delete candidatesQueue[sessionId];
    }
}

function stop(sessionId) {
    if (presenter !== null && presenter.id == sessionId) {
        for (let i in viewers) {
            let viewer = viewers[i];
            if (viewer.ws) {
                viewer.ws.send(JSON.stringify({
                    id: 'stopCommunication'
                }));
            }
        }
        presenter.pipeline.release();
        presenter = null;
        viewers = [];

    } else if (viewers[sessionId]) {
        viewers[sessionId].webRtcEndpoint.release();
        delete viewers[sessionId];
    }

    clearCandidatesQueue(sessionId);

    if (viewers.length < 1 && !presenter) {
        console.log('Closing kurento client');

        if (kurentoClient) {
            kurentoClient.close();
        }
        kurentoClient = null;
    }
}

function onIceCandidate(sessionId, _candidate) {
    let candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (presenter && presenter.id === sessionId && presenter.webRtcEndpoint) {
        console.info('Sending presenter candidate');
        presenter.webRtcEndpoint.addIceCandidate(candidate);
    }
    else if (viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
        console.info('Sending viewer candidate');
        viewers[sessionId].webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}

// ----------------------------------------------

const errors = {
    NO_MEDIA_SERVER: {
        name: 'NO_MEDIA_SERVER',
        message: 'Could not find media server at address ',
    },
    PRESENTER_EXISTS: {
        name: 'PRESENTER_EXISTS',
        message: 'Another user is currently acting as presenter. Try again later...',
    },
    PRESENTER_NOT_FOUND: {
        name: 'PRESENTER_NOT_FOUND',
        message: 'No active presenter. Try again later...',
    },
    PIPELINE_CREATE: {
        name: 'PIPELINE_CREATE',
        message: 'Error creating pipeline',
    },
    PROCESS_OFFER: {
        name: 'PROCESS_OFFER',
        message: 'Error processing offer',
    },
    GATHER_CANDIDATES: {
        name: 'GATHER_CANDIDATES',
        message: 'Error gathering candidates',
    },

    CONNECT_TO_PRESENTER: {
        name: 'CONNECT_TO_PRESENTER',
        message: 'Error connecting to presenter',
    },
}

const kurentoTypes = {
    MEDIA_PIPELINE: 'MediaPipeline',
    WEBRTC_ENDPOINT: 'WebRtcEndpoint',
}

function getKurentoCLientPromise() {
    return new Promise((resolve, reject) => {
        if (kurentoClient !== null) {
            return resolve(kurentoClient);
        }

        kurento(argv.ws_uri, function (error, _kurentoClient) {
            if (error) {
                let err = errors.NO_MEDIA_SERVER
                err.message = err.message + argv.ws_uri;
                err.message = err.message + ". Exiting with error " + error;

                return reject(err);
            }

            resolve(_kurentoClient);
        });
    });
}

function kurentoClientCreate(type, kurentoClient) {
    return new Promise((resolve, reject) => {
        kurentoClient.create(type, function (error, element) {
            if (error) {
                return reject(error);
            }

            resolve(element);
        });
    });
}

function createMediaElementsPromise(type, pipeline, sessionId) {
    return new Promise((resolve, reject) => {
        pipeline.create(type, function (error, element) {
            if (error) {
                stop(sessionId);
                let err = errors.PIPELINE_CREATE;
                err.message = error;

                return reject(error);
            }

            resolve(element);
        });
    });
}

function addIceCandidatePromise(webRtcEndpoint, ws, sessionId) {
    return new Promise((resolve, reject) => {
        if (candidatesQueue[sessionId]) {
            while (candidatesQueue[sessionId].length) {
                let candidate = candidatesQueue[sessionId].shift();
                webRtcEndpoint.addIceCandidate(candidate);
            }
        }

        webRtcEndpoint.on('OnIceCandidate', function (event) {
            let candidate = kurento.getComplexType('IceCandidate')(event.candidate);
            ws.send(JSON.stringify({
                id: 'iceCandidate',
                candidate: candidate
            }));
        });

        resolve();
    });
}

function processOfferPromise(sdpOffer, webRtcEndpoint, sessionId) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
            if (error) {
                stop(sessionId);
                let err = errors.PROCESS_OFFER;
                err.message = error;

                return reject(err);
            }

            resolve(sdpAnswer);
        });
    });
}

function gatherCandidatesPromise(webRtcEndpoint, sessionId) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.gatherCandidates(function (error) {
            if (error) {
                let err = errors.GATHER_CANDIDATES;
                err.message = error;
                stop(sessionId);

                return reject(err);
            }

            resolve();
        });
    });
}

function connectPresenterToViewer(webRtcEndpoint, sessionId) {
    return new Promise((resolve, reject) => {
        presenter.webRtcEndpoint.connect(webRtcEndpoint, function (error) {
            if (error) {
                let err = errors.CONNECT_TO_PRESENTER;
                err.message = error;
                stop(sessionId);

                return reject(err);
            }

            resolve();
        });
    });
}

function connectViewerToPresenter(webRtcEndpoint, sessionId) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.connect(presenter.webRtcEndpoint, function (error) {
            if (error) {
                let err = errors.CONNECT_TO_PRESENTER;
                err.message = error;
                stop(sessionId);

                return reject(err);
            }

            resolve();
        });
    });
}

async function startPresenterPromise(sessionId, ws, sdpOffer) {
    clearCandidatesQueue(sessionId);

    if (presenter !== null) { // presenter already exists
        stop(sessionId);
        return Promise.reject(errors.PRESENTER_EXISTS);
    }

    presenter = {
        id: sessionId,
        pipeline: null,
        webRtcEndpoint: null
    };

    let kurentoClient = await getKurentoCLientPromise();
    let pipeline = await kurentoClientCreate(kurentoTypes.MEDIA_PIPELINE, kurentoClient);

    if (presenter === null) {
        stop(sessionId);
        return Promise.reject(errors.PRESENTER_NOT_FOUND);
    }

    presenter.pipeline = pipeline;

    let webRtcEndpoint = await createMediaElementsPromise(kurentoTypes.WEBRTC_ENDPOINT, pipeline, sessionId);

    presenter.webRtcEndpoint = webRtcEndpoint;

    await addIceCandidatePromise(webRtcEndpoint, ws, sessionId);
    let sdpAnswer = await processOfferPromise(sdpOffer, webRtcEndpoint, sessionId);
    await gatherCandidatesPromise(webRtcEndpoint, sessionId);

    return sdpAnswer;
}

async function startViewerPromise(sessionId, ws, sdpOffer) {
    clearCandidatesQueue(sessionId);

    if (!presenter) {
        return Promise.reject(errors.PRESENTER_NOT_FOUND);
    }

    let viewer = {
        id: sessionId,
        webRtcEndpoint: null
    }

    let webRtcEndpoint = await createMediaElementsPromise(kurentoTypes.WEBRTC_ENDPOINT, presenter.pipeline, sessionId);

    if (presenter === null) {
        stop(sessionId);
        return Promise.reject(errors.PRESENTER_NOT_FOUND);
    }

    viewer.webRtcEndpoint = webRtcEndpoint;

    await addIceCandidatePromise(webRtcEndpoint, ws, sessionId);
    await connectPresenterToViewer(webRtcEndpoint, sessionId);
    await connectViewerToPresenter(webRtcEndpoint, sessionId);

    let sdpAnswer = await processOfferPromise(sdpOffer, webRtcEndpoint, sessionId);

    await gatherCandidatesPromise(webRtcEndpoint, sessionId);

    viewers[sessionId] = viewer;

    return sdpAnswer;
}

app.use(express.static(path.join(__dirname, 'static')));
