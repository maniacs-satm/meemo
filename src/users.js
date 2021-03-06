/* jslint node:true */

'use strict';

exports = module.exports = {
    verify: verify,
    profile: profile,
    list: list
};

var assert = require('assert'),
    bcrypt = require('bcryptjs'),
    path = require('path'),
    ldapjs = require('ldapjs'),
    safe = require('safetydance');

var LOCAL_AUTH_FILE = path.resolve(process.env.LOCAL_AUTH_FILE || './.users.json');

function verify(username, password, callback) {
    if (process.env.LDAP_URL) {
        profile(username, function (error, result) {
            if (error) return callback(null, null);

            var ldapClient = ldapjs.createClient({ url: process.env.LDAP_URL });
            ldapClient.on('error', function (error) {
                console.error('LDAP error', error);
                callback(error);
            });

            var ldapDn = 'cn=' + result.username + ',' + process.env.LDAP_USERS_BASE_DN;

            ldapClient.bind(ldapDn, password, function (error) {
                if (error) return callback(null, null);

                callback(null, { user: result });
            });
        });
    } else {
        var users = safe.JSON.parse(safe.fs.readFileSync(LOCAL_AUTH_FILE));
        if (!users) return callback(null, null);
        if (!users[username]) return callback(null, null);

        bcrypt.compare(password, users[username].passwordHash, function (error, valid) {
            if (error || !valid) return callback(null, null);

            callback(null, { user: {
                id: username,
                username: username,
                displayName: users[username].displayName
            }});
        });
    }
}

// identifier may be userId, email, username
function profile(identifier, callback) {
    assert.strictEqual(typeof identifier, 'string');
    assert.strictEqual(typeof callback, 'function');

    if (process.env.LDAP_URL) {
        var ldapClient = ldapjs.createClient({ url: process.env.LDAP_URL });
        ldapClient.on('error', function (error) {
            console.error('LDAP error', error);
            callback(error);
        });

        ldapClient.search(process.env.LDAP_USERS_BASE_DN, { filter: '(|(uid=' + identifier + ')(mail=' + identifier + ')(username=' + identifier + '))' }, function (error, result) {
            if (error) return callback(error);

            var items = [];

            result.on('searchEntry', function(entry) {
                items.push(entry.object);
            });

            result.on('error', function (error) {
                callback(error);
            });

            result.on('end', function (result) {
                if (result.status !== 0) return callback(new Error('non-zero status from LDAP search: ' + result.status));
                if (items.length === 0) return callback(new Error('Duplicate entries found'));

                var out = {
                    id: items[0].uid,
                    username: items[0].username,
                    displayName: items[0].displayname,
                    email: items[0].mail
                };

                callback(null, out);
            });
        });
    } else {
        var users = safe.JSON.parse(safe.fs.readFileSync(LOCAL_AUTH_FILE));
        if (!users) return callback(null, null);
        if (!users[identifier]) return callback(null, null);

        var result = {
            id: users[identifier].username,
            username: users[identifier].username,
            displayName: users[identifier].displayName
        };

        callback(null, result);
    }
}

function list(callback) {
    if (process.env.LDAP_URL) {
        var client = ldapjs.createClient({ url: process.env.LDAP_URL });
        client.bind(process.env.LDAP_BIND_DN, process.env.LDAP_BIND_PASSWORD, function (error) {
            if (error) return callback(error);

            client.search(process.env.LDAP_USERS_BASE_DN, { scope: 'sub' }, function (error, res) {
                if (error) return callback(error);

                var entries = [];
                res.on('searchEntry', function(entry) {
                    var data = {
                        id: entry.object.uid,
                        username: entry.object.username,
                        displayName: entry.object.displayname
                    };

                    entries.push(data);
                });
                res.on('error', callback);
                res.on('end', function () {
                    callback(null, entries);
                });
            });
        });
    } else {
        var users = safe.JSON.parse(safe.fs.readFileSync(LOCAL_AUTH_FILE));
        if (!users) return callback('No users found');

        var result = Object.keys(users).map(function (u) {
            return {
                id: users[u].username,
                username: users[u].username,
                displayName: users[u].displayName
            };
        });

        callback(null, result);
    }
}
