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

const ws = new WebSocket('wss://' + location.host + '/helloworld');
let videoInput;
let videoOutput;
let webRtcPeer;
let state = null;

const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;

$(window).on('beforeunload', function () {
	console.log('beforeunload')
	ws.close();
});

$(document).ready(function () {
	console.log('Page loaded ...');

	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');

	setState(I_CAN_START);
});

ws.onmessage = function (_message) {
	const message = JSON.parse(_message.data);
	console.info('Received message: ' + _message.data);

	switch (message.id) {
		case 'startResponse':
			startResponse(message);
			break;
		case 'error':
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Error message from server: ' + message.message);
			break;
		case 'iceCandidate':
			webRtcPeer.addIceCandidate(message.candidate)
			break;
		default:
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Unrecognized message', message);
	}
}

async function start() {
	console.log('Starting video call ...')

	// Disable start button
	setState(I_AM_STARTING);
	showSpinner(videoInput, videoOutput);

	console.log('Creating WebRtcPeer and generating local sdp offer ...');

	const constraints = {
		audio: true,
		video: {
			width: 640,
			height: 480
		}
	}

	const stream = await navigator.mediaDevices.getUserMedia(constraints);
	videoInput.srcObject = stream;
	videoInput.play();

	const options = {
		localVideo: videoInput,
		remoteVideo: videoOutput,
		onicecandidate: onIceCandidate
	}

	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function (error) {
		if (error) return onError(error);
		this.generateOffer(onOffer);
	});
}

async function startScreen() {
	console.log('Starting video call ...')

	// Disable start button
	setState(I_AM_STARTING);
	showSpinner(videoInput, videoOutput);

	console.log('Creating WebRtcPeer and generating local sdp offer ...');

	function onGetStream(stream) {
		videoInput.srcObject = stream;
		const options = {
			audio: true,
			videoStream: stream,
			remoteVideo: videoOutput,
			onicecandidate: onIceCandidate,
		};

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error) {
			if(error) return onError(error);

			this.generateOffer(onOffer);
		});
	}

	const stream = await navigator.mediaDevices.getDisplayMedia();
	videoInput.srcObject = stream;

	onGetStream(stream);
}

function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));

	const message = {
		id: 'onIceCandidate',
		candidate: candidate
	};
	sendMessage(message);
}

function onOffer(error, offerSdp) {
	if (error) return onError(error);

	console.info('Invoking SDP offer callback function ' + location.host);
	const message = {
		id: 'start',
		sdpOffer: offerSdp
	}
	sendMessage(message);
}

function onError(error) {
	console.error(error);
}

function startResponse(message) {
	setState(I_CAN_STOP);
	console.log('SDP answer received from server. Processing ...');
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function stop() {
	console.log('Stopping video call ...');
	setState(I_CAN_START);
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;

		const message = {
			id: 'stop'
		}
		sendMessage(message);
	}
	hideSpinner(videoInput, videoOutput);
}

function setState(nextState) {
	switch (nextState) {
		case I_CAN_START:
			$('#start').attr('disabled', false);
			$('#start').attr('onclick', 'start()');
			$('#startScreen').attr('disabled', false);
			$('#startScreen').attr('onclick', 'startScreen()');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		case I_CAN_STOP:
			$('#start').attr('disabled', true);
			$('#startScreen').attr('disabled', true);
			$('#stop').attr('disabled', false);
			$('#stop').attr('onclick', 'stop()');
			break;

		case I_AM_STARTING:
			$('#start').attr('disabled', true);
			$('#start').removeAttr('onclick');
			$('#startScreen').attr('disabled', true);
			$('#startScreen').removeAttr('onclick');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		default:
			onError('Unknown state ' + nextState);
			return;
	}
	state = nextState;
}

function sendMessage(message) {
	const jsonMessage = JSON.stringify(message);
	console.log('Sending message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (let i = 0;i < arguments.length;i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (let i = 0;i < arguments.length;i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function (event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});
