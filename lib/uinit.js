/*global dome, cull, bane, when, uinit*/
/**
 * @author Christian Johansen (christian@cjohansen.no)
 * @license MIT
 *
 * Copyright (c) 2013 Christian Johansen
 */
this.uinit = function () {
    var C = cull;

    /**
     * Check if `feature` has all its dependencies satiesfied in the `features`
     * object (which uses feature/dependency names as keys, feature descriptions
     * as values).
     */
    function dependenciesSatiesfied(features, feature) {
        return C.reduce(function (satiesfied, dep) {
            return satiesfied && features[dep] && features[dep].loaded;
        }, true, feature.depends || []);
    }

    /**
     * Return an array of "results" (return-values and/or resolved values from
     * returned promises) of the features listed in `dependencies`.
     */
    function dependencyResults(features, deps) {
        return C.map(function (dep) { return features[dep].result; }, deps);
    }

    function cacheCall(feature, args) {
        cacheCall.cache[feature.name] = args;
    }

    cacheCall.cache = {};

    function calledBefore(feature, args) {
        var cache = cacheCall.cache[feature.name];
        if (!cache) { return false; }

        for (var i = 0, l = args.length; i < l; ++i) {
            if (!uinit.areEqual(args[i], cache[i])) { return false; }
        }

        return true;
    }

    /**
     * Mark the feature as loaded and load it when all arguments have
     * materialized.
     */
    function loadFeature(app, features, feature, element) {
        if (feature.reloading) {
            app.emit("reloading", feature);
        } else {
            app.emit("loading", feature);
        }

        var args = dependencyResults(features, feature.depends || []);
        var deferred = when.defer();

        when.all(args).then(function (materialized) {
            var allArgs = (element ? [element] : []).concat(materialized);
            var cacheArgs = feature.serializeArgs.apply(feature, allArgs);
            if (feature.reloading && calledBefore(feature, cacheArgs)) {
                app.emit("skip", feature);
                return deferred.resolve();
            }
            cacheCall(feature, cacheArgs);

            try {
                var result = feature.action.apply(null, allArgs);

                if (result || feature.nullable) {
                    feature.loaded = true;
                    feature.result = result;
                    app.emit("loaded", feature, result);
                }
            } catch(e) {
                app.emit("error", feature, e);
            }
            deferred.resolve();
        }, function (error) {
            app.emit("error", feature, error);
            deferred.resolve();
        });

        return deferred.promise;
    }

    /**
     * Attempt to load a feature in a given context. If the feature depends on
     * elements, it will not be loaded if the provided context does not contain
     * any matching elements.
     */
    function tryFeatureInAppContext(app, feature) {
        var load = C.partial(loadFeature, app, app.features, feature);
        if (feature.elements) {
            return when.all(C.map(load, dome.byClass(feature.elements, app.context)));
        } else {
            return load();
        }
    }

    /**
     * When trying to load features, this function is used to determine if a
     * feature is ready to be proactively loaded (and has not already been
     * loaded).
     */
    function isReady(features, feature) {
        return !feature.lazy &&
            !feature.loaded &&
            feature.action &&
            dependenciesSatiesfied(features, feature);
    }

    /** Returns true if the feature is both pending (not loaded) and lazy */
    function pendingLazy(feature) {
        return feature && feature.lazy && !feature.loaded;
    };

    /**
     * For all the features in `featureArr`, find the unique set of dependencies
     * that are both pending and lazy.
     */
    function lazyDependencies(features, featureArr) {
        var toLoad = C.select(function (f) { return !f.lazy; }, featureArr);
        var getDep = function (dep) { return features[dep]; };

        function loadDeps(feature) {
            if (!feature) { return; }
            toLoad.push(feature);

            C.doall(loadDeps, C.select(function (f) {
                return toLoad.indexOf(f) < 0;
            }, C.map(getDep, feature.depends || [])));
        }

        C.doall(loadDeps, C.reduce(function (deps, f) {
            return deps.concat(C.map(getDep, f.depends || []));
        }, [], toLoad));

        return C.select(pendingLazy, C.uniq(toLoad));
    }

    /** Set properties on all objects in the collection */
    function setAll(objects, props) {
        return C.doall(function (object) {
            C.doall(function (prop) {
                object[prop] = props[prop];
            }, C.keys(props));
        }, objects);
    }

    /** Temporarily mark a set of features as eager (i.e. not lazy) */
    function makeEager(features) {
        return setAll(features, { lazy: false, wasLazy: true });
    }

    /**
     * Reset the state of features: Revert temporarily eager ones, and mark
     * loaded features as not loaded so they can be considered for loading again
     * (used for consecutive calls to load()).
     */
    function reset(features) {
        C.doall(function (feature) {
            // Environment variables don't have actions, they're always loaded
            if (feature.action) {
                feature.loaded = false;
                delete feature.reloading;
            }
            if (feature.wasLazy) {
                delete feature.wasLazy;
                feature.lazy = true;
            }
        }, features);
    }

    function logPending(app, features) {
        if (!app.listeners || !app.listeners.pending) { return; }
        C.doall(C.bind(app, "emit", "pending"), C.select(function (f) {
            return !f.ready && !f.loaded && !f.reloading;
        }, features));
    }

    /**
     * Keep trying to load features until there are no more features ready to
     * load. When one feature is enabled we start from the top again as that
     * may have enabled features that were previously not ready.
     */
    function tryFeatures(app, featureArr) {
        var deps = makeEager(lazyDependencies(app.features, featureArr)) || [];
        var isReadyToLoad = C.partial(isReady, app.features);
        var toTry = C.uniq(deps.concat(featureArr));

        function tryNext() {
            var feature = C.first(isReadyToLoad, toTry);
            if (!feature) {
                logPending(app, featureArr);
                return;
            }

            tryFeatureInAppContext(app, feature).then(function () {
                if (!feature.loaded) {
                    // If the feature is not loaded after trying, it's depending
                    // on elements, but no matching elements were found. Ignore
                    // this feature for now, re-evaluate during the next pass.
                    var idx = C.indexOf(feature, toTry);
                    toTry = toTry.slice(0, idx).concat(toTry.slice(idx + 1));
                }
                tryNext();
            });
        }

        // Start trying features
        tryNext();
    }

    function ensureUnique(features, name) {
        if (features[name]) {
            throw new Error("Cannot add duplicate " + name);
        }
    }

    var appInstance;

    function getDependencies() {
        return C.map(function (depName) {
            return appInstance.features[depName] || {
                name: depName,
                type: "Unknown"
            };
        }, this.depends || []);
    }

    function addFeature(app, feature) {
        if (!feature.hasOwnProperty("nullable")) {
            feature.nullable = true;
        }
        if (!feature.hasOwnProperty("serializeArgs")) {
            feature.serializeArgs = function () {
                return C.map(function (a) {
                    return (a && a.tagName && a.appendChild) ? dome.uuid(a) : a;
                }, arguments);
            };
        }

        feature.dependencies = getDependencies;
        app.features[feature.name] = feature;
        app.tryPending();
    }

    function dependingOn(deps, features) {
        var upstream = [], prevLength;
        var featureArr = C.values(features);

        do {
            prevLength = upstream.length;

            cull.doall(function (dep) {
                upstream = upstream.concat(C.select(function (feature) {
                    return C.indexOf(dep, feature.depends || []) >= 0;
                }, featureArr));
            }, deps);

            upstream = C.uniq(upstream);
            deps = C.map(C.prop("name"), upstream);
        } while (prevLength !== upstream.length);

        return upstream;
    }

    function prepareFeature(name, fn, opt) {
        if (typeof name === "function") {
            opt = fn;
            fn = name;
            name = fn.name;
        }

        if (!name) { throw new Error("Name cannot be blank"); }
        var feature = opt || {};
        feature.name = name;
        feature.action = fn;
        return feature;
    }

    function reload(app, dep) {
        var toRetry = dependingOn([dep], app.features);
        reset(toRetry);
        C.doall(function (f) { f.reloading = true; }, toRetry);
        tryFeatures(app, toRetry);
    }

    appInstance = bane.createEventEmitter({
        features: {},

        env: function (name, value) {
            if (value === null || value === undefined) { return; }
            this.nullableEnv(name, value);
        },

        nullableEnv: function (name, value) {
            var exists = !!this.env[name];

            // Verify uniqueness if env variable has never been set before.
            // Overwriting env vars is allowed, but writing an env var over an
            // existing feature/data is not.
            if (!exists) {
                ensureUnique(this.features, name);
            }

            var changed = value !== this.env[name];
            this.env[name] = value;
            addFeature(this, { name: name, result: value, loaded: true });

            if (exists && this.loaded && changed) {
                reload(this, name);
            }
        },

        data: function (name, fn, opt) {
            var feature = prepareFeature(name, fn, opt);
            ensureUnique(this.features, feature.name);
            if (typeof feature.lazy !== "boolean") {
                feature.lazy = true;
            }
            if (typeof feature.nullable !== "boolean") {
                feature.nullable = false;
            }
            return addFeature(this, feature);
        },

        feature: function (name, fn, opt) {
            var feature = prepareFeature(name, fn, opt);
            ensureUnique(this.features, feature.name);
            if (typeof feature.action !== "function") {
                this.emit("error", new Error("Cannot add feature " + feature.name +
                                             ", action is not a function (" +
                                             typeof feature.action + ")"));
                return;
            }
            addFeature(this, feature);
        },

        scanEnvAttrs: function (element, prefix) {
            var children = element.getElementsByTagName("*");
            var elements = [element].concat([].slice.call(children, 0));
            var attr, attrs, j, k;

            for (var i = 0, l = elements.length; i < l; ++i) {
                attrs = elements[i].attributes;

                for (j = 0, k = attrs.length; j < k; ++j) {
                    attr = attrs.item(j);
                    if (attr.nodeName.indexOf(prefix) === 0) {
                        this.env(attr.nodeName.slice(prefix.length), attr.nodeValue);
                    }
                }
            }
        },

        load: function (context) {
            if (this.loaded) { reset(C.values(this.features)); }
            this.loaded = true;
            this.context = context;
            this.tryPending();
        },

        tryPending: function () {
            if (!this.loaded) { return; }
            this.emit("init");
            tryFeatures(this, C.values(this.features));
        }
    });

    return appInstance;
};

this.uinit.areEqual = function (a, b) { return a === b; };
