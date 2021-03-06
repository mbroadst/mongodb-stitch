# mongodb-stitch

The original source is located in `src/`.
To transpile to pure JS, run `npm run build` which places the output into `dist/`.

### [Documentation](https://s3.amazonaws.com/stitch-sdks/js/docs/master/index.html)

### Usage

Construct a simple app-wide client:
```
import { StitchClient } from 'stitch';
let appId = 'sample-app-ovmyj';
let stitchClient = new StitchClient(appId);
```

Authenticate anonymously:
```
stitchClient.anonymousAuth()
  .then(() => console.log('logged in as: ' + stitchClient.auth().user._id))
  .catch(e => console.log('error: ', e));
```

Access MongoDB APIs:
```
let db = stitchClient.service('mongodb', 'mongodb1').db('app-ovmyj'); // mdb1 is the name of the mongodb service registered with the app.
let itemsCollection = db.collection('items');

// CRUD operations:
let userId = stitchClient.authedId();
itemsCollection.insertMany([ { owner_id: userId, x: 'item1' }, { owner_id: userId, x: 'item2' }, { owner_id: userId, x: 'item3' } ])
  .then(result => console.log('success: ', result))
  .catch(e => console.log('error: ', e));
```

Access other services:
```
// executePipeline takes an array of pipeline stages.
stitchClient.executePipeline([
  {
    action: 'literal',
    args: {
      items: [ { name: 'hi' }, { name: 'hello' }, { name: 'goodbye' } ]
    }
  },
  {
    action: 'match',
    args: {
      expression: { name: 'hello' }
    }
  }
])
  .then(result => console.log('success: ', result))
  .catch(e => console.log('error: ', e));;
```
