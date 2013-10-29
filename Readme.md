# Uinit - UI init

An initialization system for UI modules. Declare dependencies between features,
scalars, data and elements and have modules loaded as soon as possible.

Uinit provides an "app", which is a mechanism for configuring "features"/UI
components that should launch on page load and possibly also at later times. A
"feature" is simply a function that may depend on an element, some data from the
network and/or local variables. The app defines an API for adding such features,
and provides a simple mechanism for them to declaratively state their
dependencies.

The app also has a mechanism for processing errors, logging debug information,
and reloading the features if e.g. parts of the page has been modified/reloaded.

## Environment variables

Environment variables can be set by anyone at any time. This is typically useful
whenever a server-side HTML template needs to inject some data into the
client-side scripts, e.g.:

```html
<script>app.env("ip_addr", "192.168.0.1");</script>
```

Features can list environment variables as dependencies. Environment variables
can also be set through data attributes (see the `scanEnvAttrs` method below).

## Data

Some features may require access to data that is not immediately present in the
page. The typical example is data fetched via XMLHttpRequest, but 'data' is by
no means restricted to that.

Data is registered with a name and a function. The function will only ever be
called if another task (data/feature) depends on it via its name. The function
may either return some data directly, or return a promise. If it throws an
error, or the returned promise rejects, the error will be passed on to the app's
failure listeners. When the returned promise resolves, the result is passed to
any features waiting for the data. Data may also have dependencies (e.g. on
certain variables or other, see "Feature" below).

## Feature

A "feature" is a function to be called on page load, and possibly also at a
later point (e.g. if parts of the page has been rebuilt). Features may depend on
specific elements to be available, data and environment variables. A feature may
also have additional data provided as input for when it is called (if
dependencies are resolved).

# API

## `var app = uinit();`

Create an app instance. On any given page you will most likely only need one app
instance.

## `app.env(name, value);`

Set environment data. Values are not specially treated and can be anything,
except for null and undefined. When the value is null or undefined, the function
silently aborts. To force null/undefined env vars, use `nullableEnv`. If the app
has been loaded, setting an environment variable will result in trying to load
pending features.

## `app.nullableEnv(name, value)`

Set environment variable to any value, including null and undefined.

## `app.data(name, fn[, opt])`

The data function may return a promise. If there are no features that depend on
this piece of data, the function will never be called. It is possible to express
dependencies for data - see lazy features below.

## `app.feature(name, fn[, opt])`

Register a feature. Features may depend on environment variables, data, and even
the result of other features. Additionally, features may depend on DOM elements.
DOM elements can only be selected by a single class name. If the class name
matches no elements, the feature will not be called. Otherwise, the feature is
called once for each element, like so:

```js
feature(element[, dependencies][, options]);
```

Given the following feature:

```js
app.feature("tweetui", loadTweets, {
    elements: "tweet-placeholder",
    depends: ["account", "tweets"]
});
```

Where "account" is an environment variable and "tweets" is a data task, the
function will eventually be called like this:

```js
loadTweets(element1, accountValue, tweetsData);
loadTweets(element2, accountValue, tweetsData);
// ...
```

If depending on another feature, its return value will be the input. If the
feature in question returned a promise, the resolution will be passed as input
(after that feature has resolved). A feature may be "lazy", in which case it is
only loaded if another feature depends on it. Data events are just lazy
features, e.g.:

```js
app.feature("tweets", function () {
    return reqwest({ url: "/tweets" });
}, { lazy: true });
```

Is equivalent to:

```js
app.data("tweets", function () {
    return reqwest({ url: "/tweets" });
});
```

`name` can be any string.

## `app.scanEnvAttrs(element, prefix);`

Scan an element and its children for attributes that set environment variables.
This allows you to set environment variables through data attributes instead of
relying on having a global app instance to call `env` on.

Given this markup:

```html
<div id="container">
  <h2 data-myapp-env-tweets-url="/tweets">Tweets</h2>
  <div class="tweets-container"></div>
</div>
```

You could do the following:

```js
var app = uinit();

app.data("tweets", function (url) {
    return reqwest(url);
}, {
    depends: ["tweets-url"]
});

app.feature("list-tweets", function (container, tweets) {
    // Render tweets in the container somehow
}, {
    elements: ["tweets-container"],
    depends: ["tweets"]
});

app.scanEnvAttrs(document.getElementById("container"), "data-myapp-env-");
app.load();
```

The [`reqwest`](https://github.com/ded/reqwest) function already has the
required API (a function that accept an URL and returns a promise). We would
also want to extract the rendering logic into a separate testable function, so
the above example could be more succinctly expressed as:


```js
var app = uinit();

app.data("tweets", reqwest, { depends: ["tweets-url"] });

app.feature("list-tweets", renderTweets, {
    elements: ["tweets-container"],
    depends: ["tweets"]
});

app.scanEnvAttrs(document.getElementById("container"), "data-myapp-env-");
app.load(document.body);
```

## `app.load(element);`

Load the app. This function may be called multiple times. It takes a DOM element
to use as its root. Only elements inside this root element will be considered
when attempting to load features.

## `app.tryPending();`

After loading the app, some features may still not be loaded if the elements
they depend on are not available. `tryPending` retries all those features. If
you call `app.load(element)` and then modify the DOM within the context element
you may want to call this to ensure your modified elements are considered for
pending features.

If you want already loaded features to reload for newly added elements/changed
DOM structure you need to call `load()` over again. If app is not loaded, this
method does nothing.

## Events

The app emits the following events:

### `app.on("loading", function (feature) {});`

When a feature's dependencies are satiesfied, it is scheduled for loading. At
this point some of the feature's input may still be unresolved (if any of it is
the result of asynchronous operations). The feature may still fail to load, if
asynchronous dependencies fail to materialize.

### `app.on("loaded", function (feature, result) {});`

When a feature has successfully materialized (i.e. the returned promise
resolved, or it didn't return a promise). If a feature depends on multiple
elements, this event will be emitted once per element.

### `app.on("pending", function (feature) {});`

A feature's dependencies were not satiesfied, thus it was not loaded. To
investigate why the feature did not load, look at its dependencies:

```js
app.on("pending", function (feature) {
    feature.dependencies(); // [{ name: "A", loaded: false }, ...]
});
```

### `app.on("error", function (feature, error) {});`

When errors occur, or promises are rejected as the app is loading features, and
when adding features where the function/action is not present.


## License

### The MIT License (MIT)

**Copyright (C) 2013 Christian Johansen**

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
