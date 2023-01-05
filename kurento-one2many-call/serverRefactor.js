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

const errors = require('./errors');

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
const candidatesQueue = {};
let kurentoClient = null;
let presenter = null;
const viewers = [];

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

    const sessionId = nextUniqueId();
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
        const message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
            case 'presenter':
                startPresenter(sessionId, ws, message.sdpOffer, message.type)
                    .then(sdpAnswer => {
                        ws.send(JSON.stringify({
                            id: 'presenterResponse',
                            response: 'accepted',
                            sdpAnswer: sdpAnswer
                        }));
                    })
                    .catch(error => {
                        console.log('<<<<<<<<<<<<<<<<<<<',error, '>>>>>>>>>>>>>>>>>>>>>>>>>');
                        stop(sessionId);
                        ws.send(JSON.stringify({
                            id: 'presenterResponse',
                            response: 'rejected',
                            message: error?.name + ': ' + error?.message
                        }));
                    });
                break;

            case 'viewer':
                startViewer(sessionId, ws, message.sdpOffer)
                    .then(sdpAnswer => {
                        ws.send(JSON.stringify({
                            id: 'viewerResponse',
                            response: 'accepted',
                            sdpAnswer: sdpAnswer
                        }));
                    })
                    .catch(error => {
                        stop(sessionId);
                        ws.send(JSON.stringify({
                            id: 'viewerResponse',
                            response: 'rejected',
                            message: error.name + ': ' + error.message
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
    if (candidatesQueue[sessionId]) delete candidatesQueue[sessionId];
}

function stop(sessionId) {
    if (presenter !== null && presenter.id == sessionId) { // if the one who is leaving is the presenter
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

        while (viewers?.length) {
            viewers.shift();
        }
    } else if (viewers[sessionId]) {
        viewers[sessionId].webRtcEndpoint.release();
        delete viewers[sessionId];
    }

    clearCandidatesQueue(sessionId);

    if (viewers.length < 1 && !presenter) { // if there are no more viewers and no presenter
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

const kurentoTypes = {
    MEDIA_PIPELINE: 'MediaPipeline',
    WEBRTC_ENDPOINT: 'WebRtcEndpoint',
    RECORDER_ENDPOINT: 'RecorderEndpoint'
}

function getKurentoCLient() {
    return new Promise((resolve, reject) => {
        if (kurentoClient !== null) {
            return resolve(kurentoClient);
        }

        kurento(argv.ws_uri, function (error, _kurentoClient) {
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

function kurentoClientCreate(type, kurentoClient) {
    return new Promise((resolve, reject) => {
        kurentoClient.create(type, function (error, element) {
            if (error) {
                const err = errors.KURENTO_CLIENT_CREATE
                err.message = error

                return reject(err);
            }

            resolve(element);
        });
    });
}

function createMediaElements(type, pipeline, recorderType) {
    console.log("🚀 ~ file: serverRefactor.js:257 ~ createMediaElements ~ type", type)
    console.log("🚀 ~ file: serverRefactor.js:257 ~ createMediaElements ~ recorderType", recorderType)
    return new Promise((resolve, reject) => {
        if (type === kurentoTypes.RECORDER_ENDPOINT) {
            let mediaProfile = null;

            switch (recorderType) {
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
                {
                    type: kurentoTypes.RECORDER_ENDPOINT,
                    params: {
                        uri: `file:///tmp/one2many-${Date.now().toString()}.webm`, // where to save the video
                        mediaProfile: mediaProfile, // video format
                        stopOnEndOfStream: true, // stop recording when the stream is finished
                        stopTimeOut: 1000, // 1 second using for stopOnEndOfStream
                    }
                }
            ];

            pipeline.create(elements, function (error, elements) {
                if (error) {
                    pipeline.release();
                    const err = errors.CREATE_MEDIA_ELEMENTS
                    err.message = error;

                    return reject(err);
                }

                const recorderEndpoint = elements[0];
                resolve(recorderEndpoint);
            });

        } else {
            pipeline.create(type, function (error, element) {
                if (error) {
                    pipeline.release();
                    const err = errors.CREATE_MEDIA_ELEMENTS
                    err.message = error;

                    return reject(error);
                }

                resolve(element);
            });
        }

    });
}

function connectWebRtcEndpointWithRecorder(pipeline, webRtcEndpoint, recorderEndpoint) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.connect(recorderEndpoint, (error) => {
            if (error) {
                const err = errors.CONNECT_MEDIA_ELEMENTS
                err.message = error;
                pipeline.release();

                return reject(err);
            }

            recorderEndpoint.record((error) => {
                if (error) {
                    const err = errors.RECORD_MEDIA_ELEMENT
                    err.message = error;
                    pipeline.release();

                    return reject(err);
                }

                return resolve();
            });
        });
    });
}

function addingIceCandidate(webRtcEndpoint, ws, sessionId) {
    return new Promise((resolve, reject) => {
        while (candidatesQueue[sessionId]?.length) {
            const candidate = candidatesQueue[sessionId].shift();
            webRtcEndpoint.addIceCandidate(candidate);
        }

        webRtcEndpoint.on('OnIceCandidate', function (event) {
            const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
            ws.send(JSON.stringify({
                id: 'iceCandidate',
                candidate: candidate
            }));
        });

        resolve();
    });
}

function processOffer(sdpOffer, webRtcEndpoint) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
            if (error) {
                const err = errors.PROCESS_OFFER;
                err.message = error;

                return reject(err);
            }

            resolve(sdpAnswer);
        });
    });
}

function gatherCandidates(webRtcEndpoint) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.gatherCandidates(function (error) {
            if (error) {
                const err = errors.GATHER_CANDIDATES;
                err.message = error;

                return reject(err);
            }

            resolve();
        });
    });
}

function connectPresenterToViewer(webRtcEndpoint) {
    return new Promise((resolve, reject) => {
        presenter.webRtcEndpoint.connect(webRtcEndpoint, function (error) {
            if (error) {
                const err = errors.CONNECT_TO_PRESENTER;
                err.message = error;

                return reject(err);
            }

            resolve();
        });
    });
}

function connectViewerToPresenter(webRtcEndpoint) {
    return new Promise((resolve, reject) => {
        webRtcEndpoint.connect(presenter.webRtcEndpoint, function (error) {
            if (error) {
                const err = errors.CONNECT_TO_PRESENTER;
                err.message = error;

                return reject(err);
            }

            resolve();
        });
    });
}

async function startPresenter(sessionId, ws, sdpOffer, recorderType) {
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

    const kurentoClient = await getKurentoCLient();
    const pipeline = await kurentoClientCreate(kurentoTypes.MEDIA_PIPELINE, kurentoClient);

    presenter.pipeline = pipeline;

    const webRtcEndpoint = await createMediaElements(kurentoTypes.WEBRTC_ENDPOINT, pipeline);
    await addingIceCandidate(webRtcEndpoint, ws, sessionId);
    const recorderEndpoint = await createMediaElements(kurentoTypes.RECORDER_ENDPOINT, pipeline, recorderType);

    await connectWebRtcEndpointWithRecorder(pipeline, webRtcEndpoint, recorderEndpoint);

    presenter.webRtcEndpoint = webRtcEndpoint;

    const sdpAnswer = await processOffer(sdpOffer, webRtcEndpoint);
    await gatherCandidates(webRtcEndpoint);

    return sdpAnswer;
}

async function startViewer(sessionId, ws, sdpOffer) {
    clearCandidatesQueue(sessionId);

    if (!presenter) {
        return Promise.reject(errors.PRESENTER_NOT_FOUND);
    }

    const viewer = {
        id: sessionId,
        webRtcEndpoint: null
    }

    const webRtcEndpoint = await createMediaElements(kurentoTypes.WEBRTC_ENDPOINT, presenter.pipeline);

    viewer.webRtcEndpoint = webRtcEndpoint;

    await addingIceCandidate(webRtcEndpoint, ws, sessionId);
    await connectPresenterToViewer(webRtcEndpoint);
    await connectViewerToPresenter(webRtcEndpoint);

    const sdpAnswer = await processOffer(sdpOffer, webRtcEndpoint);

    await gatherCandidates(webRtcEndpoint);

    viewers[sessionId] = viewer;

    return sdpAnswer;
}

app.use(express.static(path.join(__dirname, 'static')));
