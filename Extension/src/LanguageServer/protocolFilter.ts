/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { Middleware, ProvideHoverSignature } from 'vscode-languageclient';
import { Client } from './client';
import * as vscode from 'vscode';
import { CppSettings } from './settings';
import { clients, onDidChangeActiveTextEditor } from './extension';
import { getOutputChannelLogger, Logger } from '../logger';

export function createProtocolFilter(): Middleware {
    // Disabling lint for invoke handlers
    const invoke1 = async (a: any, next: (a: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a); };
    const invoke2 = async (a: any, b: any, next: (a: any, b: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a, b); };
    const invoke3 = async (a: any, b: any, c: any, next: (a: any, b: any, c: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a, b, c); };
    const invoke4 = async (a: any, b: any, c: any, d: any, next: (a: any, b: any, c: any, d: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a, b, c, d); };
    // const invoke5 = async (a: any, b: any, c: any, d: any, e: any, next: (a: any, b: any, c: any, d: any, e: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a, b, c, d, e); };
    /* tslint:enable */

    return {
        didOpen: async (document, sendMessage) => {
            const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) {
                // If the file was visible editor when we were activated, we will not get a call to
                // onDidChangeVisibleTextEditors, so immediately open any file that is visible when we receive didOpen.
                // Otherwise, we defer opening the file until it's actually visible.
                const me: Client = clients.getClientFor(document.uri);
                if (!me.TrackedDocuments.has(document)) {
                    // Log warm start.
                    clients.timeTelemetryCollector.setDidOpenTime(document.uri);
                    if (clients.checkOwnership(me, document)) {
                        me.TrackedDocuments.add(document);
                        const finishDidOpen = async (doc: vscode.TextDocument) => {
                            await me.provideCustomConfiguration(doc.uri, undefined);
                            await clients.ActiveClient.awaitUntilLanguageClientReady();
                            const out: Logger = getOutputChannelLogger();
                            out.appendLine("protocolFilter - sending didOpen message via sendMessage(doc)");
                            await sendMessage(doc);
                            me.onDidOpenTextDocument(doc);
                            if (editor && editor === vscode.window.activeTextEditor) {
                                onDidChangeActiveTextEditor(editor);
                            }
                        };
                        let languageChanged: boolean = false;
                        if ((document.uri.path.endsWith(".C") || document.uri.path.endsWith(".H")) && document.languageId === "c") {
                            const cppSettings: CppSettings = new CppSettings();
                            if (cppSettings.autoAddFileAssociations) {
                                const fileName: string = path.basename(document.uri.fsPath);
                                const mappingString: string = fileName + "@" + document.uri.fsPath;
                                me.addFileAssociations(mappingString, "cpp");
                                me.sendDidChangeSettings();
                                const newDoc: vscode.TextDocument = await vscode.languages.setTextDocumentLanguage(document, "cpp");
                                await finishDidOpen(newDoc);
                                languageChanged = true;
                            }
                        }
                        if (!languageChanged) {
                            await finishDidOpen(document);
                        }
                    }
                }
            } else {
                // NO-OP
                // If the file is not opened into an editor (such as in response for a control-hover),
                // we do not actually load a translation unit for it.  When we receive a didOpen, the file
                // may not yet be visible.  So, we defer creation of the translation until we receive a
                // call to onDidChangeVisibleTextEditors(), in extension.ts.  A file is only loaded when
                // it is actually opened in the editor (not in response to control-hover, which sends a
                // didOpen), and first becomes visible.
            }
        },
        didChange: async (textDocumentChangeEvent, sendMessage) => {
            const me: Client = clients.getClientFor(textDocumentChangeEvent.document.uri);
            if (!me.TrackedDocuments.has(textDocumentChangeEvent.document)) {
                console.log("!!!!!!!!!!!!!!!!!!!!!! We shouldn't get here.  didChange should not occur until didOpen has been processed.");
                // processDelayedDidOpen(textDocumentChangeEvent.document);
            }
            me.onDidChangeTextDocument(textDocumentChangeEvent);
            await clients.ActiveClient.awaitUntilLanguageClientReady();
            await sendMessage(textDocumentChangeEvent);
        },
        willSave: invoke1,
        willSaveWaitUntil: async (event, sendMessage) => {
            const me: Client = clients.getClientFor(event.document.uri);
            if (me.TrackedDocuments.has(event.document)) {
                // Don't use me.requestWhenReady or notifyWhenLanguageClientReady;
                // otherwise, the message can be delayed too long.
                return sendMessage(event);
            }
            const result: vscode.TextEdit[] = [];
            return result;
        },
        didSave: invoke1,
        didClose: async (document, sendMessage) => {
            const me: Client = clients.getClientFor(document.uri);
            if (me.TrackedDocuments.has(document)) {
                me.onDidCloseTextDocument(document);
                me.TrackedDocuments.delete(document);
                await clients.ActiveClient.awaitUntilLanguageClientReady();
                await sendMessage(document);
                // me.notifyWhenLanguageClientReady(() => sendMessage(document));
            }
        },

        provideCompletionItem: invoke4,
        resolveCompletionItem: invoke2,
        provideHover: async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideHoverSignature) => {
            const me: Client = clients.getClientFor(document.uri);
            if (me.TrackedDocuments.has(document)) {
                await clients.ActiveClient.awaitUntilLanguageClientReady();
                return next(document, position, token);
            }
            return null;
        },
        provideSignatureHelp: invoke4,
        provideDefinition: invoke3,
        provideReferences: invoke4,
        provideDocumentHighlights: invoke3,
        provideDeclaration: invoke3
        // I believe the default handler will do the same thing.
        // workspace: {
        //     didChangeConfiguration: (sections, sendMessage) => sendMessage(sections)
        // }
    };
}
