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

const ws = new WebSocket('wss://' + location.host + '/one2many');
let video;
let webRtcPeer;
let room;
let username;
let recordType = 'screen';

$(document).ready(function () {
	video = document.getElementById('video');

	$('#call').click(() => presenter());
	$('#callScreen').click(() => presenterScreen());
	$('#viewer').click(() => viewer());
	$('#terminate').click(() => stop());

	$('#record').attr('onclick', 'record()');
	room = $('#room').val();
	username = $('#username').val();

	$('#room').on('change', () => room = $('#room').val());
	$('#username').val(localStorage.getItem('siruntu_username'));
	$('#username').on('change', () => {
		username = $('#username').val()
		localStorage.setItem('siruntu_username', username);
	});

});

$(window).on('beforeunload', function () {
	ws.close();
});

function onError(error) {
	Swal.fire({
		icon: 'error',
		title: 'Oops...',
		text: error,
	})

	console.error(error);
}

ws.onmessage = function (_message) {
	const message = JSON.parse(_message.data);
	console.info('Received message: ' + _message.data);

	switch (message.id) {
		case 'presenterResponse':
			presenterResponse(message);
			break;
		case 'viewerResponse':
			viewerResponse(message);
			break;
		case 'recordResponse':
			recordResponse(message);
			break;
		case 'stopRecordResponse':
			stopRecordResponse(message);
			break;
		case 'stopCommunication':
			if (message.room == room)
				dispose();
			break;
		case 'iceCandidate':
			webRtcPeer.addIceCandidate(message.candidate)
			break;
		default:
			console.error('Unrecognized message', message);
	}
}

function presenterResponse(message) {
	if (message.response != 'accepted') {
		const errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);

		onError(errorMsg);
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function viewerResponse(message) {
	if (message.response != 'accepted') {
		const errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);

		onError(errorMsg);
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function recordResponse(message) {
	if (message.response != 'accepted') {
		const errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);

		return onError(errorMsg);
	}

	Swal.fire({
		icon: 'success',
		title: 'Recording',
		text: 'Recording started',
	})

	$('#record').html('Stop Recording ...');
	$('#record').attr('onclick', 'stopRecord()');
	$('#record').removeClass('btn-success');
	$('#record').addClass('btn-danger');
}

function stopRecordResponse(message) {
	if (message.response != 'accepted') {
		const errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);

		return onError(errorMsg);
	}

	Swal.fire({
		icon: 'success',
		title: 'Recording',
		text: 'Recording stopped',
	})

	$('#record').html('Record');
	$('#record').attr('onclick', 'record()');
	$('#record').removeClass('btn-danger');
	$('#record').addClass('btn-success');
}

function presenter() {
	if (!room) return onError('You must insert room name');
	if (!username) return onError('You must insert your username');

	if (!webRtcPeer) {
		showSpinner(video);

		const options = {
			localVideo: video,
			onicecandidate: onIceCandidate
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function (error) {
			if (error) return onError(error);

			this.generateOffer(onOfferPresenter);
		});
	}
}

async function presenterScreen() {
	if (!room) return onError('You must insert room name');

	if (!webRtcPeer) {
		showSpinner(video);

		const stream = await navigator.mediaDevices.getDisplayMedia();
		video.srcObject = stream;
		onGetStream(stream);

		function onGetStream(stream) {
			video.srcObject = stream;
			const cstrx = {
				audio: false,
				video: {
					width: { max: 640 },
					height: { max: 480 },
					framerate: { exact: 15 }
				}
			};

			const options = {
				sdpConstraints: cstrx,
				sendSource: 'screen',
				videoStream: stream,

				// remoteVideo: videoOutput,
				onicecandidate: onIceCandidate
			};

			webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function (error) {
				if (error) return onError(error);

				this.generateOffer(onOfferPresenterScreen);
			});
		}
	}
}

function onOfferPresenter(error, offerSdp) {
	if (error) return onError(error);

	recordType = 'webcam'

	const message = {
		id: 'presenter',
		sdpOffer: offerSdp,
		type: recordType,
		room: room,
		username: username
	};
	sendMessage(message);
}

function onOfferPresenterScreen(error, offerSdp) {
	if (error) return onError(error);

	recordType = 'screen'

	const message = {
		id: 'presenter',
		sdpOffer: offerSdp,
		type: recordType,
		room: room,
		username: username
	};
	sendMessage(message);
}

function viewer() {
	if (!room) return onError('You must insert room name');
	if (!username) return onError('You must insert your username');

	if (!webRtcPeer) {
		showSpinner(video);

		const options = {
			remoteVideo: video,
			onicecandidate: onIceCandidate
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function (error) {
			if (error) return onError(error);

			this.generateOffer(onOfferViewer);
		});
	}
}

function record() {
	if (!room) return onError('You must insert room name');

	const message = {
		id: 'record',
		room: room,
		type: recordType
	};
	sendMessage(message);
}

function stopRecord() {
	const message = {
		id: 'stopRecord',
		room: room
	};

	sendMessage(message);
}

function onOfferViewer(error, offerSdp) {
	if (error) return onError(error)

	const message = {
		id: 'viewer',
		sdpOffer: offerSdp,
		room: room,
		username: username
	}
	sendMessage(message);
}

function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));

	const message = {
		id: 'onIceCandidate',
		candidate: candidate
	}
	sendMessage(message);
}

function stop() {
	console.log('Stopping video call ...')
	if (webRtcPeer) {
		const message = {
			id: 'stop'
		}
		sendMessage(message);
		dispose();

		$('#record').html('Record');
		$('#record').attr('onclick', 'record()');
		$('#record').removeClass('btn-danger');
		$('#record').addClass('btn-success');
	}
}

function dispose() {
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;
	}
	hideSpinner(video);
}

function sendMessage(message) {
	const jsonMessage = JSON.stringify(message);
	console.log('Sending message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (let i = 0;i < arguments.length;i++) {
		arguments[i].poster = '/img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (let i = 0;i < arguments.length;i++) {
		arguments[i].src = '';
		arguments[i].poster = '/img/unhas.png';
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
