/*
 * @author David Menger
 */
'use strict';

const crypto = require('crypto');
const { Request } = require('wingbot');
const FacebookSender = require('./FacebookSender');

const PROCESS_EVENTS = [
    'postback',
    'referral',
    'optin',
    'pass_thread_control',
    'message',
    'request_thread_control',
    'take_thread_control',
    'read',
    'delivery'
];

/**
 * @typedef {Object} AttachmentCache
 * @prop {Function} findAttachmentByUrl
 * @prop {Function} saveAttachmentId
 */

class Facebook {

    /**
     *
     * @param {Processor} processor
     * @param {Object} options
     * @param {string} options.pageToken - facebook page token
     * @param {string} options.appId - facebook app id
     * @param {string} [options.botToken] - botToken for webhook verification
     * @param {string} [options.appSecret] - provide app secret to verify requests
     * @param {string} [options.passThreadAction] - trigger this action for pass thread event
     * @param {string} [options.takeThreadAction] - trigger this action for take thread event
     * @param {string} [options.requestThreadAction] - trigger this action when thread request
     * @param {AttachmentCache} [options.attachmentStorage] - cache for reusing attachments
     * @param {Function} [options.requestLib] - request library replacement
     * @param {console} [senderLogger] - optional console like chat logger
     */
    constructor (processor, options, senderLogger = null) {
        this.processor = processor;
        this._options = options;
        this._senderLogger = senderLogger;
    }

    _getUnauthorizedError (message) {
        const err = new Error(`Unauthorized: ${message}`);
        return Object.assign(err, { code: 401, status: 401 });
    }

    /**
     * Verifies Bots webhook against Facebook
     *
     * @param {Object} queryString
     * @throws {Error} when the request is invalid
     * @returns {string}
     */
    verifyWebhook (queryString) {
        if (!this._options.botToken) {
            throw this._getUnauthorizedError('Missing configuration (config.botToken)');
        } else if (!queryString['hub.verify_token']) {
            throw this._getUnauthorizedError('Missing hub.verify_token in query');
        } else if (queryString['hub.verify_token'] === this._options.botToken) {
            return queryString['hub.challenge'];
        } else {
            throw this._getUnauthorizedError('Wrong hub.verify_token (config.botToken)');
        }
    }

    /**
     * Verify Facebook webhook event
     *
     * @param {Buffer|string} body
     * @param {Object} headers
     * @throws {Error} when x-hub-signature does not match body signature
     * @returns {Promise}
     */
    verifyRequest (body, headers) {
        if (!this._options.appSecret) {
            return Promise.resolve();
        }

        const signature = headers['x-hub-signature'] || headers['X-Hub-Signature'];

        if (!signature) {
            throw this._getUnauthorizedError('Missing X-Hub-Signature');
        }

        const elements = signature.split('=');
        const signatureHash = elements[1];
        const expectedHash = crypto
            .createHmac('sha1', this._options.appSecret)
            .update(body)
            .digest('hex');

        if (signatureHash !== expectedHash) {
            throw this._getUnauthorizedError('Couldn\'t validate the request signature.');
        }
        return Promise.resolve();
    }

    _processEventsOfSender (senderId, events) {
        return events.reduce(
            (promise, { message, pageId }) => promise
                .then(() => this.processMessage(message, senderId, pageId)),
            Promise.resolve()
        );
    }

    /**
     *
     * @param {Object} message - wingbot chat event
     * @param {string} senderId - chat event sender identifier
     * @param {string} pageId - channel/page identifier
     * @returns {Promise<{status:number}>}
     */
    processMessage (message, senderId, pageId) {
        const options = this._options;

        const messageSender = new FacebookSender(
            options,
            senderId,
            message,
            this._senderLogger,
            options.requestLib
        );

        let event = message;

        if (message.take_thread_control) {
            const takeToSelf = `${message.take_thread_control
                .previous_owner_app_id}` === `${this._options.appId}`;

            if (this._options.takeThreadAction && !takeToSelf) {
                event = Request.postBack(
                    senderId,
                    this._options.takeThreadAction,
                    message.take_thread_control,
                    null,
                    null,
                    message.timestamp
                );
            } else {
                event = null;
            }
        } else if (message.pass_thread_control) {
            if (this._options.passThreadAction) {
                event = Request.postBack(
                    senderId,
                    this._options.passThreadAction,
                    message.pass_thread_control,
                    null,
                    null,
                    message.timestamp
                );
            } else {
                event = null;
            }
        } else if (message.request_thread_control) {
            if (this._options.requestThreadAction) {
                event = Request.postBack(
                    senderId,
                    this._options.requestThreadAction,
                    message.request_thread_control,
                    null,
                    null,
                    message.timestamp
                );
            } else {
                event = null;
            }
        }

        if (!event) {
            return Promise.resolve({ status: 201 });
        }

        return this.processor.processMessage(event, pageId, messageSender);
    }

    /**
     * Process Facebook request
     *
     * @param {Object} body - event body
     * @returns {Promise<Array<{message:Object,pageId:string}>>} - unprocessed events
     */
    async processEvent (body) {
        const otherEvents = [];

        if (body.object !== 'page') {
            return otherEvents;
        }

        const eventsBySenderId = new Map();

        body.entry.forEach((event) => {
            const pageId = event.id;

            event.messaging.forEach((message) => {

                if (PROCESS_EVENTS.some(e => typeof message[e] !== 'undefined')) {
                    const senderId = (message.sender && message.sender.id) || null;

                    if (!eventsBySenderId.has(senderId)) {
                        eventsBySenderId.set(senderId, []);
                    }

                    eventsBySenderId.get(senderId).push({ message, pageId });
                } else {
                    otherEvents.push({ message, pageId });
                }
            });
        });

        const process = Array.from(eventsBySenderId.entries())
            .map(([senderId, events]) => this._processEventsOfSender(senderId, events));

        await Promise.all(process);

        return otherEvents;
    }
}

module.exports = Facebook;
