# Prompt: Deep research with status report

We are working through this implementation plan:
"""
"""
With this latest status update:
"""
"""

And this previous research:
"""

""" 

Can you please help us get unblocked by performing the research mentioned in the status report?

# Prompt: Deep research for RAGAS

We have finished implementing this plan:
"""

"""

As you can see from this server.js:
```

```

And this seedData.js:
```

```

And this viewVectors.js:
```

```

We also have this Dockerfile:
```

```

And this docker-compose.yml:
```

```

Now we would like you to research and create a new detailed implementation plan that will help us add RAGAS testing and evaluation to our current setup.
Note that we also have a postman json file that we use to run a basic search test.

# Prompt: Evaluate code effectiveness

We have finished implementing this plan:
"""

"""
And are currently working on this plan:
"""

"""

As you can see from this server.js:
```

```

And this viewVectors.js:
```

```

And this evaluateRagas.js:
```

```

Which uses these test_cases.json:
```

```

And is run from package.json commands:
```

```

Can you please evaluate our progress so far and look for any potential issues or problems with the implementation?

# Prompt: Evaluate project from Github

I'd like you to start by reviewing our application in github: https://github.com/BryceEWatson/RAG_img_search/tree/RAGAS_v1

In the RAGAS_v1 branch we've included our latest changes, which are intended to implement this RAGAS implementation plan: https://github.com/BryceEWatson/RAG_img_search/blob/RAGAS_v1/Documentation/Plans/RAGAS_Implementation_Plan.md

However, after making these changes we notice that our package.json commands no longer return any messaging and don't appear to make changes to the database. See:
"""
PS C:\Users\Bryce\Projects\RAG_img_search> npm run seed:view

> rag-image-search@1.0.0 seed:view
> node scripts/viewVectors.js

PS C:\Users\Bryce\Projects\RAG_img_search> npm run generate:test-cases

> rag-image-search@1.0.0 generate:test-cases
> node scripts/generateTestCases.js

PS C:\Users\Bryce\Projects\RAG_img_search> npm run seed:view

> rag-image-search@1.0.0 seed:view
> node scripts/viewVectors.js
"""

Please perform research on this project and help us determine why our package.json commands are not working as expected.