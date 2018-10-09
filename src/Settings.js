/*
 * @author David Menger
 */
'use strict';

const request = require('request-promise-native');
const deepEqual = require('fast-deep-equal');
const MenuComposer = require('./MenuComposer');

/**
 * Utility, which helps us to set up chatbot behavior
 *
 * @class Settings
 */
class Settings {

    /**
     * Creates an instance of Settings.
     *
     * @param {string} token
     * @param {{error:Function}} [log]
     * @param {Function} [req] - request library for resting purposes
     *
     * @memberOf Settings
     */
    constructor (token, log = console, req = request) {
        this.token = token;
        this.request = req;
        this.log = log;
    }

    _post (data) {
        return this.request({
            uri: 'https://graph.facebook.com/v2.8/me/messenger_profile',
            qs: { access_token: this.token },
            method: 'POST',
            json: data
        }).catch(e => this.log.error('Bot settings failed', e));
    }

    _get (fields = null) {
        const queryString = { access_token: this.token };
        if (fields) {
            queryString.fields = fields.join(',');
        }
        return request({
            uri: 'https://graph.facebook.com/v2.8/me/messenger_profile',
            qs: queryString,
            method: 'GET',
            json: true
        }).catch((e) => {
            this.log.error('Bot settings failed', e);
            return Promise.reject(e);
        });
    }

    _delete (data) {
        return request({
            uri: 'https://graph.facebook.com/v2.8/me/messenger_profile',
            qs: { access_token: this.token },
            method: 'DELETE',
            json: data
        }).catch(e => this.log.error('Bot settings failed', e));
    }

    /**
     * Sets or clears bot's greeting
     *
     * @param {string} [text=false] - leave empty to clear
     * @returns {Promise}
     *
     * @memberOf Settings
     */
    greeting (text = null) {
        if (text) {
            return this._post({
                greeting: [
                    {
                        locale: 'default',
                        text
                    }
                ]
            });
        }
        return this._delete({
            fields: ['greeting']
        });
    }

    /**
     * Sets up the Get Started Button
     *
     * @param {string|Object} [payload=false] - leave blank to remove button, or provide the action
     * @returns {Promise}
     *
     * @example
     * const settings = new Settings(config.facebook.pageToken);
     * settings.getStartedButton('/start'); // just an action
     *
     * @memberOf Settings
     */
    getStartedButton (payload = false) {
        if (payload) {
            return this._post({
                get_started: { payload }
            });
        }

        return this._delete({
            fields: ['get_started']
        });
    }

    /**
     * Useful for using facebook extension in webviews
     *
     * @param {string|string[]} domains
     * @returns {Promise}
     *
     * @memberOf Settings
     */
    whitelistDomain (domains) {
        let list;

        if (typeof domains === 'string') {
            list = [domains];
        } else {
            list = domains;
        }

        list = list.map(dom => dom.replace(/\/$/, ''));

        return this._post({
            whitelisted_domains: list
        });
    }

    /**
     * Sets up the persistent menu
     *
     * @param {string} [locale]
     * @param {boolean} [inputDisabled=false]
     * @returns {MenuComposer}
     * @example
     *
     * const { Settings } = require('wingbot');
     *
     * const settings = new Settings('page-token-string');
     *
     * settings
     *      .menu('fr_FR')
     *          .addNested('Nested Menu')
     *              .addUrl('Aller à google', 'https://google.com')
     *              .done()
     *          .addPostBack('Faire quelque chose', '/the/action')
     *      .menu() // the default menu
     *          .addNested('Nested Menu')
     *              .addUrl('Go to google', 'https://google.com')
     *              .done()
     *          .addPostBack('Do something', '/the/action')
     *      .done();
     */
    menu (locale = 'default', inputDisabled = false) {
        const composer = new MenuComposer(newMenu => (
            this._get(['persistent_menu'])
                .then((result) => {
                    let updateMenu;

                    if (result.data.length === 0) {
                        updateMenu = true;
                    } else {
                        const existingMenu = result.data[0].persistent_menu;
                        updateMenu = !deepEqual(newMenu, existingMenu);
                    }

                    if (!updateMenu) {
                        return Promise.resolve();
                    }

                    return this._post({
                        persistent_menu: newMenu
                    });
                })
                .catch(e => this.log.error('Bot settings failed', e))
        ));

        return composer.menu(locale, inputDisabled);
    }

}

module.exports = Settings;
