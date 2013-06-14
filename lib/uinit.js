/*global dome, cull, bane, when, uinit*/
/**
 * An "app" is a mechanism for configuring "features"/UI components that should
 * launch on page load and possibly also at later times. A "feature" is simply a
 * function that may depend on an element, some data from the network and/or
 * local variables. The app defines an API for adding such features, and
 * provides a simple mechanism for them to declaratively state their
 * dependencies.
 *
 * The app also has a mechanism for processing errors, logging debug information
 * and reloading the features if e.g. parts of the page has been
 * modified/reloaded.
 *
 * Environment variables
 *
 * Environment variables can be set by anyone at any time. This is typically
 * useful whenever a server-side HTML template needs to inject some data into
 * the client-side scripts, e.g.:
 *
 *     <script>appInstance.env("ip_addr", "192.168.0.1");</script>
 *
 * Features can list environment variables as dependencies.
 *
 * Data
 *
 * Some features may require access to data that is not immediately present in
 * the page. The typical example is data fetched via XMLHttpRequest, but 'data'
 * is by no means restricted to that.
 *
 * Data is registered with a name and a function. The function will only ever be
 * called if a task depends on it via its name. The function may either return
 * some data directly, or return a promise. If it throws an error, or the
 * returned promise rejects, the error will be passed on to the app's failure
 * listeners. When the returned promise resolves, the result is passed to any
 * features waiting for the data. Data may also have dependencies (e.g. on
 * certain variables or other, see "Feature" below).
 *
 * Feature
 *
 * A "feature" is a function to be called on page load, and possibly also at a
 * later point (e.g. if parts of the page has been rebuilt). Features may
 * depend on specific elements to be available, data and environment variables.
 * A feature may also have additional data provided as input for when it is
 * called (if dependencies are resolved).
 *
 * Events
 *
 * The app emits the following events:
 *
 * "loading" (feature)
 *
 * When a feature's dependencies are satiesfied, it is scheduled for loading. At
 * this point some of the feature's input may still be unresolved (if any of it
 * is the result of asynchronous operations). The feature may still fail to
 * load, if asynchronous dependencies fail to materialize.
 *
 * "loaded" (feature, result)
 *
 * When a feature has successfully materialized (i.e. the returned promise
 * resolved, or it didn't return a promise). If a feature depends on multiple
 * elements, this event will be emitted once per element.
 *
 * "pending" (feature)
 *
 * A feature's dependencies were not satiesfied, thus it was not loaded. To
 * investigate why the feature did not load, look at its dependencies:
 *
 *     app.on("pending", function (feature) {
 *         feature.dependencies(); // [{ name: "A", loaded: false }, ...]
 *     });
 *
 * "error" (feature, error)
 *
 * When errors occur, or promises are rejected as the app is loading features.
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

    function cacheArray(args, element) {
        return element ? args.concat(dome.uuid(element)) : args;
    }

    function cacheCall(feature, args, element) {
        cacheCall.cache[feature.name] = cacheArray(args, element);
    }

    cacheCall.cache = {};

    function calledBefore(feature, args, element) {
        var cache = cacheCall.cache[feature.name];
        if (!cache) { return false; }
        var arr = cacheArray(args, element);

        for (var i = 0, l = arr.length; i < l; ++i) {
            if (!uinit.areEqual(arr[i], cache[i])) { return false; }
        }

        return true;
    }

    /**
     * Mark the feature as loaded and load it when all arguments have
     * materialized.
     */
    function loadFeature(app, features, feature, element) {
        app.emit("loading", feature);
        var args = dependencyResults(features, feature.depends || []);
        if (feature.reloading && calledBefore(feature, args, element)) {
            return when.resolve();
        }
        cacheCall(feature, args, element);
        var deferred = when.defer();

        when.all(args).then(function (materialized) {
            var allArgs = (element ? [element] : []).concat(materialized);
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
        var getDep = function (dep) { return features[dep]; };
        return C.uniq(C.reduce(function (lazy, feature) {
            return lazy.concat(C.select(
                pendingLazy,
                C.map(getDep, feature.depends || [])
            ));
        }, [], featureArr));
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
            return !f.ready && !f.loaded;
        }, features));
    }

    /**
     * Keep trying to load features until there are no more features ready to
     * load. When one feature is enabled we start from the top again as that
     * may have enabled features that were previously not ready.
     */
    function tryFeatures(app, featureArr, cb) {
        var deps = makeEager(lazyDependencies(app.features, featureArr));
        var isReadyToLoad = C.partial(isReady, app.features);
        var toTry = C.uniq(deps.concat(featureArr));

        function tryNext() {
            var feature = C.first(isReadyToLoad, toTry);
            if (!feature) {
                logPending(app, featureArr);
                return (typeof cb === "function" ? cb() : null);
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

        /**
         * Set environment data. Values are not specially treated and can be
         * anything, except for null and undefined. When the value is null or
         * undefined, this function silently aborts. To force null/undefined env
         * vars, use nullableEnv(). If the app has been loaded, setting an
         * environment variable will result in trying to load pending features.
         */
        env: function (name, value) {
            if (value === null || value === undefined) { return; }
            this.nullableEnv(name, value);
        },

        /**
         * Set environment variable to any value, including null and undefined.
         */
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

        /**
         * The data function may return a promise. If there are no tasks that
         * depend on this piece of data, the function will never be called. It
         * is possible to express dependencies for data - see lazy features
         * below.
         */
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

        /**
         * Register a feature. Features may depend on environment variables,
         * data, and even other features. Additionally, features may depend on
         * DOM elements. DOM elements can only be selected by a single class
         * name. If the class name matches no elements, the feature will not be
         * called. Otherwise, the feature is called once for each element, like
         * so:
         *
         *     feature(element[, dependencies][, options]);
         *
         * Given the following feature:
         *
         *     appInstance.feature("tweetui", loadTweets, {
         *         elements: "tweet-placeholder",
         *         depends: ["account", "tweets"]
         *     });
         *
         * Where "account" is an environment variable and "tweets" is a data
         * event, the function will eventually be called like this:
         *
         *     loadTweets(element1, accountValue, tweetsData);
         *     loadTweets(element2, accountValue, tweetsData);
         *     // ...
         *
         * If depending on another feature, its return-value will be the input.
         * If the feature in question returned a promise, the resolution will be
         * passed as input (after that feature has resolved).
         *
         * A feature may be "lazy", in which case it is only loaded if another
         * feature depends on it. Data events are just lazy features, e.g.:
         *
         *     appInstance.feature("tweets", function () {
         *         return reqwest({ url: "/tweets" });
         *     }, { lazy: true });
         *
         * Is equivalent to:
         *
         *     appInstance.data("tweets", function () {
         *         return reqwest({ url: "/tweets" });
         *     });
         *
         * The `name` can be any string.
         */
        feature: function (name, fn, opt) {
            var feature = prepareFeature(name, fn, opt);
            ensureUnique(this.features, feature.name);
            if (typeof feature.action !== "function") {
                throw new Error("Cannot add feature " + feature.name +
                                ", action is not a function (" +
                                typeof feature.action + ")");
            }
            addFeature(this, feature);
        },

        /**
         * Scan an element and its children for attributes that set environment
         * variables.
         */
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

        /**
         * Load the app. This function may be called multiple times. It
         * optionally accepts a DOM element to use as its root. If it is not
         * provided, the document itself is used as the root.
         */
        load: function (context) {
            if (this.loaded) { reset(C.values(this.features)); }
            this.loaded = true;
            this.context = context;
            this.tryPending();
        },

        /**
         * After loading the app, some features may still not be loaded if the
         * elements they depend on are not available. `tryPending` retries all
         * those features. If you call app.load(context) and then modify the DOM
         * within the context element you may want to call this to ensure your
         * modified elements are considered for pending features.
         *
         * If you want already loaded features to reload for newly added
         * elements/changed DOM structure you need to call load() over again.
         *
         * If app is not loaded, this method does nothing.
         */
        tryPending: function () {
            if (!this.loaded) { return; }
            this.emit("init");
            tryFeatures(this, C.values(this.features));
        }
    });

    return appInstance;
};

this.uinit.areEqual = function (a, b) { return a === b; };
