# Terminal.js

Sadly, there is no conveneint way to perform low overhead text tracing in modern web browsers.
If you are doing `printf` debugging and have to deal with lots of text data your options are limited:

1. Use the browser's developer tools console.
  * Opening the developer tools often slows down your application, which is very annoying if you're trying to understand performance problems.
  * Consoles have a ton of features but can't do very simple things well, like handle lots of text. If you write a lot of text to the console, you'll hang the browser.

2. Write text to the DOM.
  * You can build your own console using HTML elements. This is only slightly better than using the developer tools.
  You're still allocating tons of memory and possibly causing page reflows if you're not careful.

3. Write your own text view using Canvas 2D.
  * This works fairly well. You can manage your own string buffer and draw a portion of it with Canvas2D text commands.
  The only drawback here is that you have to keep around a bunch of strings in the JS heap, creating memory pressure.
  You can optimize things by only decoding strings when they are needed but then you allocate lots of new strings, which is not idea.
  I spent a lot of time optimizing this, but at the end of the day it's still not cheap.

4. Pipe the console output to stdout. You can do this in Firefox and Chrome using some perfs and command line arguments. This is a good idea, do this if you can.

5. Use this library.
  * Text is encoded as a `Uint8Array` and uploaded to the GPU as a texture where it's then drawn by a fragment shader.
  * Aside from managing the memory of the text buffer, no allocations happen during tracing and rendering.

