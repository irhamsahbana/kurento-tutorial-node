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
    CREATE_MEDIA_ELEMENTS: {
        name: 'CREATE_MEDIA_ELEMENTS',
        message: 'Error creating media element'
    },
    CONNECT_MEDIA_ELEMENTS: {
        name: 'CONNECT_MEDIA_ELEMENTS',
        message: 'Error connecting media elements'
    },
    RECORD_MEDIA_ELEMENT: {
        name: 'RECORD_MEDIA_ELEMENT',
        message: 'Error recording media element'
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
    ROOM_NOT_PROVIDED: {
        name: 'ROOM_NOT_PROVIDED',
        message: 'Room not provided',
    },
    WS_NOT_PROVIDED: {
        name: 'WS_NOT_PROVIDED',
        message: 'WebSocket not provided',
    },

    ONLY_PRESENTER_CAN_RECORD: {
        name: 'ONLY_PRESENTER_CAN_RECORD',
        message: 'Only presenter can record',
    },
    ALREADY_RECORDING: {
        name: 'ALREADY_RECORDING',
        message: 'Already recording',
    },
    NOT_RECORDING: {
        name: 'NOT_RECORDING',
        message: 'Not recording',
    },
    ALREADY_PAUSED: {
        name: 'ALREADY_PAUSED',
        message: 'Already paused',
    },
    MEDIA_ELEMENTS_NOT_FOUND: {
        name: 'MEDIA_ELEMENTS_NOT_FOUND',
        message: 'Media elements not found, check if the presenter is streaming and have pipeline, recorder and webRtcEndpoint',
    },
}

module.exports = errors