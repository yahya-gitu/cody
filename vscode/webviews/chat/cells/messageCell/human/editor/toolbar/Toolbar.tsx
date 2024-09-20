import type { ChatMessage, Model } from '@sourcegraph/cody-shared'
import { useExtensionAPI, useObservable } from '@sourcegraph/prompt-editor'
import clsx from 'clsx'
import { type FunctionComponent, useCallback, useMemo } from 'react'
import type { UserAccountInfo } from '../../../../../../Chat'
import { useClientActionDispatcher } from '../../../../../../client/clientState'
import { ModelSelectField } from '../../../../../../components/modelSelectField/ModelSelectField'
import type { PromptOrDeprecatedCommand } from '../../../../../../components/promptList/PromptList'
import { PromptSelectField } from '../../../../../../components/promptSelectField/PromptSelectField'
import { onPromptSelectInPanel } from '../../../../../../prompts/PromptsTab'
import { useConfig } from '../../../../../../utils/useConfig'
import { AddContextButton } from './AddContextButton'
import { SubmitButton, type SubmitButtonState } from './SubmitButton'

/**
 * The toolbar for the human message editor.
 */
export const Toolbar: FunctionComponent<{
    userInfo: UserAccountInfo

    isEditorFocused: boolean

    onMentionClick?: () => void

    onSubmitClick: (intent?: ChatMessage['intent']) => void
    submitState: SubmitButtonState

    /** Handler for clicks that are in the "gap" (dead space), not any toolbar items. */
    onGapClick?: () => void

    focusEditor?: () => void

    hidden?: boolean
    className?: string
    experimentalOneBoxEnabled?: boolean
}> = ({
    userInfo,
    isEditorFocused,
    onMentionClick,
    onSubmitClick,
    submitState,
    onGapClick,
    focusEditor,
    hidden,
    className,
    experimentalOneBoxEnabled,
}) => {
    /**
     * If the user clicks in a gap or on the toolbar outside of any of its buttons, report back to
     * parent via {@link onGapClick}.
     */
    const onMaybeGapClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            const targetIsToolbarButton = event.target !== event.currentTarget
            if (!targetIsToolbarButton) {
                event.preventDefault()
                event.stopPropagation()
                onGapClick?.()
            }
        },
        [onGapClick]
    )

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only relevant to click areas
        <menu
            role="toolbar"
            aria-hidden={hidden}
            hidden={hidden}
            className={clsx(
                'tw-flex tw-items-center tw-justify-between tw-flex-wrap-reverse tw-border-t tw-border-t-border tw-gap-2 [&_>_*]:tw-flex-shrink-0',
                className
            )}
            onMouseDown={onMaybeGapClick}
            onClick={onMaybeGapClick}
        >
            <div className="tw-flex tw-items-center">
                {/* Can't use tw-gap-1 because the popover creates an empty element when open. */}
                {onMentionClick && (
                    <AddContextButton
                        onClick={onMentionClick}
                        className="tw-opacity-60 focus-visible:tw-opacity-100 hover:tw-opacity-100 tw-mr-2"
                    />
                )}
                <PromptSelectFieldToolbarItem focusEditor={focusEditor} className="tw-ml-1 tw-mr-1" />
                <ModelSelectFieldToolbarItem
                    userInfo={userInfo}
                    focusEditor={focusEditor}
                    className="tw-mr-1"
                />
            </div>
            <div className="tw-flex-1 tw-flex tw-justify-end">
                <SubmitButton
                    onClick={onSubmitClick}
                    isEditorFocused={isEditorFocused}
                    state={submitState}
                    experimentalOneBoxEnabled={experimentalOneBoxEnabled}
                />
            </div>
        </menu>
    )
}

const PromptSelectFieldToolbarItem: FunctionComponent<{
    focusEditor?: () => void
    className?: string
}> = ({ focusEditor, className }) => {
    const dispatchClientAction = useClientActionDispatcher()

    const onSelect = useCallback(
        (item: PromptOrDeprecatedCommand) => {
            onPromptSelectInPanel(item, () => {}, dispatchClientAction)
            focusEditor?.()
        },
        [focusEditor, dispatchClientAction]
    )

    return <PromptSelectField onSelect={onSelect} onCloseByEscape={focusEditor} className={className} />
}

const ModelSelectFieldToolbarItem: FunctionComponent<{
    userInfo: UserAccountInfo
    focusEditor?: () => void
    className?: string
}> = ({ userInfo, focusEditor, className }) => {
    const config = useConfig()

    const api = useExtensionAPI()

    const onModelSelect = useCallback(
        (model: Model) => {
            api.setChatModel(model.id).subscribe({
                error: error => console.error('setChatModel:', error),
            })
            focusEditor?.()
        },
        [api.setChatModel, focusEditor]
    )

    const { value: chatModels } = useObservable(useMemo(() => api.models(), [api.models]))

    return (
        !!chatModels?.length &&
        (userInfo.isDotComUser || config.configFeatures.serverSentModels) && (
            <ModelSelectField
                models={chatModels}
                onModelSelect={onModelSelect}
                serverSentModelsEnabled={config.configFeatures.serverSentModels}
                userInfo={userInfo}
                onCloseByEscape={focusEditor}
                className={className}
            />
        )
    )
}
