import cookie from 'cookie_js'
import 'whatwg-fetch' // fetch polyfill

const USER_AUTH_KEY = "_baas_ua";
const REFRESH_TOKEN_KEY = "_baas_rt";

function checkStatus(response) {
  if (response.status >= 200 && response.status < 300) {
    return response
  } else {
    var error = new Error(response.statusText)
    error.response = response
    throw error
  }
}

export class BaasClient {
  constructor(appUrl) {
    this.appUrl = appUrl;
    this.authUrl = `${this.appUrl}/auth`
    this.checkRedirectResponse();
  }

  authWithLocal(username, password, cors){
    let headers = new Headers();
    headers.append('Accept', 'application/json');
    headers.append('Content-Type', 'application/json');

    let init = {
      method: "POST",
      body: JSON.stringify({"username": username, "password": password}),
      headers: headers
    };

    if (cors) {
      init['cors'] = cors;
    }

    return fetch(`${this.authUrl}/local/userpass`, init)
      .then(checkStatus)
      .then((response)=>{
        return response.json().then((json) => {
          this._setAuth(json);
          Promise.resolve();
        })
      })
  }

  authWithOAuth(providerName){
    window.location.replace(`${this.authUrl}/oauth2/${providerName}?redirect=${encodeURI(this.baseUrl())}`);
  }

  linkWithOAuth(providerName){
    if (this.auth() === null) {
      throw "Must auth before execute"
    }
    window.location.replace(`${this.authUrl}/oauth2/${providerName}?redirect=${encodeURI(this.baseUrl())}&link=${this.auth()['token']}`);
  }

  logout() {
    let myHeaders = new Headers()
    myHeaders.append('Accept', 'application/json')
    myHeaders.append('Content-Type', 'application/json')

    fetch(this.authUrl + "/logout",
    {
      method: 'DELETE',
      headers: myHeaders,
    }).done((data) => {
      localStorage.removeItem(USER_AUTH_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      location.reload();
    }).fail((data) => {
      // This is probably the wrong thing to do since it could have
      // failed for other reasons.
      localStorage.removeItem(USER_AUTH_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      location.reload();
    });
  }

  auth(){
    if (localStorage.getItem(USER_AUTH_KEY) === null) {
      return null;
    }
    return JSON.parse(atob(localStorage.getItem(USER_AUTH_KEY)));
  }

  authedId(){
    var a = this.auth();
    if (a == null) {
      return null;
    }
    return a['user']['_id'];
  }
  
  baseUrl(){
    return [location.protocol, '//', location.host, location.pathname].join('');
  }

  _setAuth(json) {
    let rt = json['refreshToken'];
    delete json['refreshToken'];

    localStorage.setItem(USER_AUTH_KEY, btoa(JSON.stringify(json)));
    localStorage.setItem(REFRESH_TOKEN_KEY, rt);
  }

  checkRedirectResponse(){
    if (typeof window === 'undefined') {
      return
    }

    var query = window.location.search.substring(1);
    var vars = query.split('&');
    var found = false;
    for (var i = 0; i < vars.length; i++) {
        var pair = vars[i].split('=');
        if (decodeURIComponent(pair[0]) == "_baas_error") {
          this.lastError = decodeURIComponent(pair[1])
          window.history.replaceState(null, "", this.baseUrl());
          console.log(`BaasClient: error from '${this.appUrl}': ${this.lastError}`);
          found = true;
          break;
        }
        if (decodeURIComponent(pair[0]) == "_baas_ua") {
          let ua = JSON.parse(atob(decodeURIComponent(pair[1])));
          _setAuth(ua);
          found = true;
          break;
        }
        if (decodeURIComponent(pair[0]) == "_baas_link") {
          found = true;
          break;
        }
    }
    if (found) {
      window.history.replaceState(null, "", this.baseUrl());
    }
  }

  _doAuthed(resource, method, body) {

    if (this.auth() === null) {
      return Promise.reject(new Error("Must auth first"))
    }

    let url = `${this.appUrl}${resource}`;
    let headers = new Headers();
    headers.append('Accept', 'application/json');
    headers.append('Content-Type', 'application/json');
    let init = {
      method: method,
      headers: headers
    };

    if (body) {
      init['body'] = body;
    }

    headers.append('Authorization', `Bearer ${this.auth()['accessToken']}`)

    return fetch(url, init)
      .then((response) => {

        // Okay: passthrough
        if (response.status >= 200 && response.status < 300) {
          return Promise.resolve(response)

        // Unauthorized: parse and try to reauth
        } else if (response.status == 401) {
          return this._handleUnauthorized(response).then(() => {
            // Run the request again
            headers.set('Authorization', `Bearer ${this.auth()['accessToken']}`)
            return fetch(url, init);
          })
        }

        var error = new Error(response.statusText);
        error.response = response;
        throw error;
      });
  }

  _handleUnauthorized(response) {
    if (response.headers.get('Content-Type') === 'application/json') {
      return response.json().then((json) => {
        // Only want to try refreshing token when there's an invalid session
        if ('errorCode' in json && json['errorCode'] == 'InvalidSession') {
          return this._refreshToken();
        }
      });
    }

    // Can't handle this response
    var error = new Error(response.statusText);
    error.response = response;
    throw error;
  }

  _refreshToken() {
    let rt = localStorage.getItem(REFRESH_TOKEN_KEY);

    let headers = new Headers();
    headers.append('Accept', 'application/json');
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${rt}`)
    return fetch(`${this.appUrl}/auth/newAccessToken`, {
      method: 'POST',
      headers: headers
    }).then((response) => {
      if (response.status != 200) {
        var error = new Error(response.statusText);
        error.response = response;
        throw error;

      // Something is wrong with our refresh token
      } else if (response.status == 401) {
        if (response.headers.get('Content-Type') === 'application/json') {
          return response.json().then((json) => {throw json});
        }
        var error = new Error(response.statusText);
        error.response = response;
        throw error;
      }

      return response.json().then((json) => {
        this._setAccessToken(json['accessToken']);
        return Promise.resolve();
      })      
    })
  }

  _setAccessToken(token) {
    let currAuth = JSON.parse(atob(localStorage.getItem(USER_AUTH_KEY)));
    currAuth['accessToken'] = token;
    localStorage.setItem(USER_AUTH_KEY, btoa(JSON.stringify(currAuth)));
  }

  executePipeline(stages){
    return this._doAuthed('/pipeline', 'POST', JSON.stringify(stages))
      .then(checkStatus)
      .then((response)=>{
          return response.json();
        }
      )
  }

}

class DB {
  constructor(client, service, name){
    this.client = client;
    this.service = service;
    this.name = name;
  }

  getCollection(name){
    return new Collection(this, name)
  }
}

class Collection {
  constructor(db, name){
    this.db = db;
    this.name = name;
  }

  getBaseArgs() {
    return {
      "database": this.db.name,
      "collection": this.name,
    }
  }

  deleteOne(query){
    let args = this.getBaseArgs()
    args.query = query;
    args.singleDoc = true
    return this.db.client.executePipeline([
      {
        "service":this.db.service,
        "action":"delete", 
        "args":args
      }
    ])
  }

  deleteMany(query){
    let args = this.getBaseArgs()
    args.query = query;
    args.singleDoc = false
    return this.db.client.executePipeline([
      {
        "service":this.db.service,
        "action":"delete", 
        "args":args
      }
    ])
  }


  find(query, project){
    let args = this.getBaseArgs()
    args.query = query;
    args.project = project;
    return this.db.client.executePipeline([
      {
        "service":this.db.service,
        "action":"find", 
        "args":args
      }
    ])
  }

  insert(documents){
    return this.db.client.executePipeline([
      {"action":"literal",
       "args":{
          "items":documents,
       }
      },
      {
        "service":this.db.service,
        "action":"insert", 
        "args": this.getBaseArgs(),
      }
    ])
  }

  makeUpdateStage(query, update, upsert, multi){
    let args = this.getBaseArgs()
    args.query = query;
    args.update = update;
    if(upsert){
      args.upsert = true;
    }
    if(multi){
      args.multi = true;
    }

    return {
      "service":this.db.service,
      "action":"update", 
      "args":args
    }
  }

  updateOne(query, update){
    return this.db.client.executePipeline([this.makeUpdateStage(query, update, false, false)])
  }

  updateMany(query, update, upsert, multi){
    return this.db.client.executePipeline([this.makeUpdateStage(query, update, false, true)])
  }

  upsert(query, update){
    return this.db.client.executePipeline([this.makeUpdateStage(query, update, true, false)])
  }

}

export class MongoClient {

  constructor(baasClient, serviceName) {
    this.baasClient = baasClient;
    this.service = serviceName;
  }

  getDb(name){
    return new DB(this.baasClient, this.service, name)
  }

}

export class Admin {

  constructor(baseUrl){
    this._baseUrl = baseUrl
    this._client = new BaasClient(this._baseUrl);
  }

  localAuth(username, password){
    return this._client.authWithLocal(username, password, true);
  }

  logout(){
    return this._delete("/auth")
  }

  // Authed methods
   _doAuthed(url, method, data) {
    return this._client._doAuthed(url, method, JSON.stringify(data))
      .then(checkStatus)
      .then((response)=>{
        return response.json()
      })
  }

  _get(url){
    return this._doAuthed(url, "GET")
  }

  _delete(url){
    return this._doAuthed(url, "DELETE")
  }

  _post(url, data){
    return this._doAuthed(url, "POST", data)
  }

  /* Examples of how to access admin API with this client:
   *
   * List all apps
   *    a.apps().list()   
   *
   * Fetch app under name "planner"
   *    a.apps().app("planner").get()   
   *
   * List services under the app "planner"
   *    a.apps().app("planner").services().list()
   *
   * Delete a rule by ID
   *    a.apps().app("planner").services().service("mdb1").rules().rule("580e6d055b199c221fcb821d").remove()
   *
   */
  apps() {
    let root = this;
    return {
      list: ()=> root._get(`/apps`),
      create: (data) => root._post(`/apps`, data),
      app: (app) => ({
        get: ()=> root._get(`/apps/${app}`),
        remove: () => root._delete(`/apps/${app}`),

        authProviders: () => ({
          create: (data) => this._post(`/apps/${app}/authProviders`, data),
          list: () => this._get(`/apps/${app}/authProviders`), 
          provider: (authType, authName) =>({
            get: () => this._get(`/apps/${app}/authProviders/${authType}/${authName}`),
            remove: () => this._delete(`/apps/${app}/authProviders/${authType}/${authName}`),
            update: (data) => this._post(`/apps/${app}/authProviders/${authType}/${authName}`, data),
          })
        }),
        variables: () => ({
          list: ()=> this._get(`/apps/${app}/vars`),
          create: (data) => this._post(`/apps/${app}/vars`, data),
          variable: (varName)=>({
            get: () => this._get(`/apps/${app}/vars/${varName}`),
            remove: () => this._delete(`/apps/${app}/vars/${varName}`),
            update: (data) => this._post(`/apps/${app}/vars/${varName}`, data)
          })
        }),

        services: () => ({
          list: ()=> this._get(`/apps/${app}/services`),
          create: (data) => this._post(`/apps/${app}/services`, data),
          service: (svc) => ({
            get: () => this._get(`/apps/${app}/services/${svc}`),
            update: (data) => this._post(`/apps/${app}/services/${svc}`, data),
            remove: () => this._delete(`/apps/${app}/services/${svc}`),
            setConfig: (data)=> this._post(`/apps/${app}/services/${svc}/config`, data),

            rules: () => ({
              list: ()=> this._get(`/apps/${app}/services/${svc}/rules`),   
              create: (data)=> this._post(`/apps/${app}/services/${svc}/rules`),   
              rule: (ruleId) => ({
                get: ()=> this._get(`/apps/${app}/services/${svc}/rules/${ruleId}`),    
                update: (data)=> this._post(`/apps/${app}/services/${svc}/rules/${ruleId}`, data),    
                remove: ()=> this._delete(`/apps/${app}/services/${svc}/rules/${ruleId}`),
              })
            }), 

            triggers: () => ({
              list: ()=> this._get(`/apps/${app}/services/${svc}/triggers`),   
              create: (data)=> this._post(`/apps/${app}/services/${svc}/triggers`),   
              trigger: (triggerId) => ({
                get: ()=> this._get(`/apps/${app}/services/${svc}/triggers/${triggerId}`),    
                update: (data)=> this._post(`/apps/${app}/services/${svc}/triggers/${triggerId}`, data),    
                remove: ()=> this._delete(`/apps/${app}/services/${svc}/triggers/${triggerId}`),    
              })
            })
          }),
        }),
      }),
    }
  }

}