/*
 * Error definition
 */
const errors = {
    NO_MEDIA_SERVER: {
        name: 'NO_MEDIA_SERVER',
        message: 'Could not find media server at address ',
    },
    NO_SESSION_ID: {
        name: 'NO_SESSION_ID',
        message: 'Cannot use undefined sessionId'
    },
    NO_PIPELINE: {
        name: 'NO_PIPELINE',
        message: 'Cannot use undefined pipeline'
    },
    KURENTO_CLIENT_CREATE: {
        name: 'KURENTO_CLIENT_CREATE',
        message: 'Error creating Kurento client'
    },
    CREATE_MEDIA_ELEMENT: {
        name: 'CREATE_MEDIA_ELEMENT',
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
        message: 'Error processing offer'
    },
    GATHER_CANDIDATES: {
        name: 'GATHER_CANDIDATES',
        message: 'Error gathering candidates'
    },
};

module.exports = errors;